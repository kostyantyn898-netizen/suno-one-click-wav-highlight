#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Convert Suno browser downloads into a tagged local music library.

What it does:
  - scans the Downloads folder recursively;
  - copies MP3 files into Music while preserving audio and adding title/album,
    optional cover art, and optional lyrics;
  - converts WAV files into FLAC with title/artist/album, optional cover art,
    and optional lyrics;
  - overwrites an existing output file with the same name;
  - deletes the source audio plus matching sidecar cover/lyrics after success.

Expected Suno sidecar naming:
  My Song.wav
  My Song_cover.jpeg
  My Song.txt

Useful flags:
  python tools/suno_downloads_to_music.py --dry-run
  python tools/suno_downloads_to_music.py --install-deps
  python tools/suno_downloads_to_music.py --keep-source
  python tools/suno_downloads_to_music.py --src "%USERPROFILE%\\Downloads" --dst "%USERPROFILE%\\Music"

Windows env overrides:
  SUNO_CONVERT_FFMPEG, SUNO_CONVERT_FLAC, SUNO_CONVERT_METAFLAC,
  SUNO_CONVERT_DOWNLOADS, SUNO_CONVERT_MUSIC
"""

from __future__ import annotations

import argparse
import importlib
import os
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Iterable

DEFAULT_FFMPEG = r"c:\ffmpeg-8.0-full_build\bin\ffmpeg.exe"
DEFAULT_FLAC = r"c:\flac-1.4.2-win\Win64\flac.exe"
DEFAULT_METAFLAC = r"c:\flac-1.4.2-win\Win64\metaflac.exe"
DEFAULT_DOWNLOADS = r"%USERPROFILE%\Downloads"
DEFAULT_MUSIC = r"%USERPROFILE%\Music"

MP3_ALBUM = "Suno MP3"
WAV_ARTIST = "Suno"
WAV_ALBUM = "Suno WAV"

MIN_SIZE = 1000
TIMEOUT_MP3 = 180
TIMEOUT_WAV = 600
TIMEOUT_TAG = 60
SKIP_DIRS = {"_trash"}


def env_value(name: str, default: str) -> str:
    value = os.environ.get(name, "").strip()
    return expand_path(value or default)


def expand_path(value: str) -> str:
    return os.path.expandvars(os.path.expanduser(value))


def env_path(name: str, default: str) -> str:
    return str(Path(env_value(name, default)))


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert Suno MP3/WAV downloads plus cover/lyrics sidecars into tagged Music files."
    )
    parser.add_argument("--src", default=env_path("SUNO_CONVERT_DOWNLOADS", DEFAULT_DOWNLOADS),
                        help="Downloads folder to scan recursively.")
    parser.add_argument("--dst", default=env_path("SUNO_CONVERT_MUSIC", DEFAULT_MUSIC),
                        help="Destination music folder.")
    parser.add_argument("--ffmpeg", default=env_path("SUNO_CONVERT_FFMPEG", DEFAULT_FFMPEG),
                        help="Path to ffmpeg.exe.")
    parser.add_argument("--flac", default=env_path("SUNO_CONVERT_FLAC", DEFAULT_FLAC),
                        help="Path to flac.exe.")
    parser.add_argument("--metaflac", default=env_path("SUNO_CONVERT_METAFLAC", DEFAULT_METAFLAC),
                        help="Path to metaflac.exe.")
    parser.add_argument("--mp3-album", default=MP3_ALBUM,
                        help="Album tag for processed MP3 files.")
    parser.add_argument("--wav-artist", default=WAV_ARTIST,
                        help="Artist tag for converted WAV->FLAC files.")
    parser.add_argument("--wav-album", default=WAV_ALBUM,
                        help="Album tag for converted WAV->FLAC files.")
    parser.add_argument("--dry-run", "--dry", dest="dry_run", action="store_true",
                        help="Only show what would be processed.")
    parser.add_argument("--keep-source", action="store_true",
                        help="Keep source audio and sidecar files after successful processing.")
    parser.add_argument("--install-deps", action="store_true",
                        help="Allow installing missing Python dependencies (currently: mutagen).")
    return parser.parse_args(argv[1:])


def ensure_utf8_console() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass


def format_cmd(cmd: Iterable[str]) -> str:
    cmd = list(cmd)
    if os.name == "nt":
        return subprocess.list2cmdline(cmd)
    return shlex.join(cmd)


def ensure_mutagen(install_deps: bool = False) -> bool:
    try:
        importlib.import_module("mutagen.id3")
        return True
    except ImportError:
        pass

    if not install_deps:
        print("mutagen is missing.")
        print("Run again with --install-deps or install manually:")
        print(f"  {sys.executable} -m pip install mutagen")
        return False

    print("mutagen is missing; installing because --install-deps was provided...")
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", "mutagen"],
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=180,
        )
        if result.returncode != 0:
            print("Failed to install mutagen:")
            print((result.stderr or result.stdout or "")[:800])
            return False
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        print(f"Failed to install mutagen: {exc}")
        return False

    importlib.invalidate_caches()
    try:
        importlib.import_module("mutagen.id3")
        print("mutagen installed.")
        return True
    except ImportError as exc:
        print(f"mutagen installed but cannot be imported: {exc}")
        return False


def read_lyrics(txt_path: str) -> str | None:
    for encoding in ("utf-8-sig", "utf-8", "cp1251"):
        try:
            with open(txt_path, "r", encoding=encoding) as handle:
                text = handle.read()
            return text.replace("\r\n", "\n").replace("\r", "\n").rstrip("\n")
        except Exception:
            pass
    return None


def write_ffmetadata(path: str, title: str, album: str) -> None:
    def esc(value: str) -> str:
        return (value.replace("\\", "\\\\")
                     .replace("=", "\\=")
                     .replace(";", "\\;")
                     .replace("#", "\\#")
                     .replace("\n", "\\\n"))

    with open(path, "w", encoding="utf-8") as handle:
        handle.write(";FFMETADATA1\n")
        handle.write(f"title={esc(title)}\n")
        handle.write(f"album={esc(album)}\n")


def write_mp3_lyrics(mp3_path: str, lyrics: str | None) -> None:
    if not lyrics:
        return
    from mutagen.id3 import ID3, TXXX

    try:
        tags = ID3(mp3_path)
    except Exception:
        tags = ID3()
    tags.delall("TXXX:LYRICS")
    tags.delall("USLT")
    tags.add(TXXX(encoding=3, desc="LYRICS", text=lyrics))
    tags.save(mp3_path, v2_version=3)


def cleanup_tmp(folder: str, exts: tuple[str, ...] = (".mp3", ".ffmeta", ".flac", ".wav")) -> None:
    if not os.path.isdir(folder):
        return
    removed = 0
    for filename in os.listdir(folder):
        if filename.startswith("tmp") and filename.lower().endswith(exts):
            try:
                os.remove(os.path.join(folder, filename))
                removed += 1
            except Exception:
                pass
    if removed:
        print(f"Removed temporary leftovers in {folder}: {removed}")


def find_media(root: str) -> tuple[list[str], list[str]]:
    mp3s: list[str] = []
    wavs: list[str] = []

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [name for name in dirnames if name not in SKIP_DIRS]
        for filename in filenames:
            lower = filename.lower()
            full_path = os.path.join(dirpath, filename)

            if lower.startswith("tmp") and lower.endswith((".mp3", ".wav")):
                print(f"[SKIP tmp*] {full_path}")
                continue

            if lower.endswith(".mp3"):
                mp3s.append(full_path)
            elif lower.endswith(".wav"):
                wavs.append(full_path)

    mp3s.sort()
    wavs.sort()
    return mp3s, wavs


def run_capture(cmd: list[str], timeout: int) -> tuple[int, str]:
    result = subprocess.run(cmd, capture_output=True, timeout=timeout, encoding="utf-8", errors="replace")
    return result.returncode, (result.stderr or "").strip()


def delete_sources(paths: Iterable[str], keep_source: bool) -> None:
    if keep_source:
        return
    for path in paths:
        if path and os.path.exists(path):
            os.remove(path)


def output_path(dst_dir: str, filename: str) -> str:
    return os.path.join(dst_dir, filename)


def process_mp3(src_mp3: str, index: int, total: int, args: argparse.Namespace) -> tuple[bool, str | None]:
    src_dir = os.path.dirname(src_mp3)
    mp3_name = os.path.basename(src_mp3)
    base = mp3_name[:-4]
    cover_path = os.path.join(src_dir, base + "_cover.jpeg")
    txt_path = os.path.join(src_dir, base + ".txt")

    has_cover = os.path.isfile(cover_path)
    has_txt = os.path.isfile(txt_path)
    lyrics = read_lyrics(txt_path) if has_txt else None

    tmp_fd, tmp_mp3 = tempfile.mkstemp(suffix=".mp3", dir=args.dst)
    os.close(tmp_fd)
    tmp_fd2, tmp_meta = tempfile.mkstemp(suffix=".ffmeta", dir=args.dst)
    os.close(tmp_fd2)

    tmp_mp3_to_clean: str | None = tmp_mp3
    try:
        write_ffmetadata(tmp_meta, base, args.mp3_album)

        cmd = [args.ffmpeg, "-y", "-loglevel", "error", "-i", src_mp3]
        if has_cover:
            cmd += ["-i", cover_path]
        cmd += ["-i", tmp_meta]

        meta_idx = 2 if has_cover else 1
        cmd += ["-map", "0:a"]
        if has_cover:
            cmd += ["-map", "1:v"]
        cmd += ["-map_metadata", str(meta_idx), "-c:a", "copy"]
        if has_cover:
            cmd += ["-c:v", "copy", "-disposition:v", "attached_pic",
                    "-metadata:s:v", "title=Album cover", "-metadata:s:v", "comment=Cover (front)"]
        cmd += ["-id3v2_version", "3", tmp_mp3]

        rc, stderr = run_capture(cmd, TIMEOUT_MP3)
        if rc != 0:
            raise RuntimeError(stderr[:400] or f"ffmpeg exit {rc}")
        size = os.path.getsize(tmp_mp3)
        if size < MIN_SIZE:
            raise RuntimeError(f"output file is suspiciously small: {size} bytes")

        if lyrics:
            try:
                write_mp3_lyrics(tmp_mp3, lyrics)
            except Exception as exc:
                raise RuntimeError(f"mutagen lyrics: {exc}") from exc

        final_path = output_path(args.dst, mp3_name)
        os.replace(tmp_mp3, final_path)
        tmp_mp3_to_clean = None

        delete_sources([src_mp3, cover_path if has_cover else "", txt_path if has_txt else ""], args.keep_source)

        extras = []
        if has_cover:
            extras.append("cover")
        if has_txt:
            extras.append("lyrics")
        extra = f" [{', '.join(extras)}]" if extras else ""
        print(f"[{index:>3}/{total}] MP3 OK  {mp3_name}{extra}")
        return True, None

    except subprocess.TimeoutExpired:
        msg = f"timeout {TIMEOUT_MP3}s"
        print(f"[{index:>3}/{total}] MP3 ERR {mp3_name}\n           {msg}")
        return False, msg
    except Exception as exc:
        msg = str(exc)
        print(f"[{index:>3}/{total}] MP3 ERR {mp3_name}\n           {msg[:200]}")
        return False, msg
    finally:
        for path in (tmp_mp3_to_clean, tmp_meta):
            if path and os.path.exists(path):
                try:
                    os.remove(path)
                except Exception:
                    pass


def process_wav(src_wav: str, index: int, total: int, args: argparse.Namespace) -> tuple[bool, str | None]:
    src_dir = os.path.dirname(src_wav)
    wav_name = os.path.basename(src_wav)
    base = wav_name[:-4]
    cover_path = os.path.join(src_dir, base + "_cover.jpeg")
    txt_path = os.path.join(src_dir, base + ".txt")

    has_cover = os.path.isfile(cover_path)
    has_txt = os.path.isfile(txt_path)

    tmp_fd, tmp_flac = tempfile.mkstemp(suffix=".flac", dir=args.dst)
    os.close(tmp_fd)
    tmp_to_clean: str | None = tmp_flac
    try:
        cmd = [args.flac, "-8", "-f", "-o", tmp_flac,
               "-T", f"TITLE={base}",
               "-T", f"ARTIST={args.wav_artist}",
               "-T", f"ALBUM={args.wav_album}",
               src_wav]
        rc, stderr = run_capture(cmd, TIMEOUT_WAV)
        if rc != 0:
            raise RuntimeError(stderr[:400] or f"flac exit {rc}")
        size = os.path.getsize(tmp_flac)
        if size < MIN_SIZE:
            raise RuntimeError(f"output FLAC is suspiciously small: {size} bytes")

        if has_txt:
            rc, stderr = run_capture([args.metaflac, f"--set-tag-from-file=LYRICS={txt_path}", tmp_flac], TIMEOUT_TAG)
            if rc != 0:
                raise RuntimeError("metaflac lyrics: " + (stderr[:300] or f"exit {rc}"))

        if has_cover:
            rc, stderr = run_capture([args.metaflac, f"--import-picture-from={cover_path}", tmp_flac], TIMEOUT_TAG)
            if rc != 0:
                raise RuntimeError("metaflac cover: " + (stderr[:300] or f"exit {rc}"))

        final_path = output_path(args.dst, base + ".flac")
        os.replace(tmp_flac, final_path)
        tmp_to_clean = None

        delete_sources([src_wav, cover_path if has_cover else "", txt_path if has_txt else ""], args.keep_source)

        extras = []
        if has_cover:
            extras.append("cover")
        if has_txt:
            extras.append("lyrics")
        extra = f" [{', '.join(extras)}]" if extras else ""
        print(f"[{index:>3}/{total}] WAV OK  {wav_name} -> {base}.flac{extra}")
        return True, None

    except subprocess.TimeoutExpired:
        msg = f"timeout {TIMEOUT_WAV}s"
        print(f"[{index:>3}/{total}] WAV ERR {wav_name}\n           {msg}")
        return False, msg
    except Exception as exc:
        msg = str(exc)
        print(f"[{index:>3}/{total}] WAV ERR {wav_name}\n           {msg[:200]}")
        return False, msg
    finally:
        if tmp_to_clean and os.path.exists(tmp_to_clean):
            try:
                os.remove(tmp_to_clean)
            except Exception:
                pass


def main(argv: list[str]) -> int:
    ensure_utf8_console()
    args = parse_args(argv)
    args.src = expand_path(args.src)
    args.dst = expand_path(args.dst)
    args.ffmpeg = expand_path(args.ffmpeg)
    args.flac = expand_path(args.flac)
    args.metaflac = expand_path(args.metaflac)

    print("=" * 60)
    print("Suno downloads -> tagged Music files")
    print("=" * 60)
    print(f"Source:      {args.src}")
    print(f"Destination: {args.dst}")
    print(f"ffmpeg:      {args.ffmpeg}")
    print(f"flac:        {args.flac}")
    print(f"metaflac:    {args.metaflac}")
    print(f"Mode:        {'dry-run' if args.dry_run else 'convert'}")
    print(f"Source keep: {'yes' if args.keep_source else 'no'}")

    if not os.path.isdir(args.src):
        print(f"\nSource folder not found: {args.src}")
        return 1

    os.makedirs(args.dst, exist_ok=True)
    cleanup_tmp(args.dst)

    mp3s, wavs = find_media(args.src)
    total = len(mp3s) + len(wavs)
    print(f"\nFound MP3: {len(mp3s)}")
    print(f"Found WAV: {len(wavs)}")

    if total == 0:
        print("\nNothing to process.")
        return 0

    if args.dry_run:
        print("\nDRY-RUN: no conversion and no deletion.")
        for path in (mp3s + wavs)[:80]:
            print(f"  {path}")
        if total > 80:
            print(f"  ... {total - 80} more")
        return 0

    if mp3s and not os.path.isfile(args.ffmpeg):
        print(f"\nffmpeg not found: {args.ffmpeg}")
        return 1
    if wavs:
        if not os.path.isfile(args.flac):
            print(f"\nflac not found: {args.flac}")
            return 1
        if not os.path.isfile(args.metaflac):
            print(f"\nmetaflac not found: {args.metaflac}")
            return 1

    need_mutagen = any(os.path.isfile(path[:-4] + ".txt") for path in mp3s)
    if need_mutagen and not ensure_mutagen(args.install_deps):
        print("\nmutagen is unavailable, so MP3 lyrics cannot be written.")
        return 1

    ok_count = 0
    errors: list[tuple[str, str | None]] = []
    index = 0

    for path in mp3s:
        index += 1
        ok, msg = process_mp3(path, index, total, args)
        if ok:
            ok_count += 1
        else:
            errors.append((path, msg))

    for path in wavs:
        index += 1
        ok, msg = process_wav(path, index, total, args)
        if ok:
            ok_count += 1
        else:
            errors.append((path, msg))

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Successful: {ok_count}/{total}")
    print(f"Failed:     {len(errors)}")
    if errors:
        print("\nFailed files:")
        for path, msg in errors:
            print(f"  {path}")
            print(f"    {(msg or '')[:200]}")
        return 1
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv))
    except KeyboardInterrupt:
        raise SystemExit(130)
