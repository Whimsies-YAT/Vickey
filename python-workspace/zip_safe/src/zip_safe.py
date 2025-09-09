#!/usr/bin/env python3
import sys
import os
import zipfile
import json
from concurrent.futures import ThreadPoolExecutor, as_completed

MAX_FILES = 1000
MAX_TOTAL_SIZE = 100 * 1024 * 1024
SCAN_CHUNK_SIZE = 1024 * 1024

SUSPICIOUS_KEYWORDS = ["MALWARE", "TROJAN", "VIRUS", "BACKDOOR", "EXPLOIT"]
EXECUTABLE_EXTS = {'exe', 'dll', 'so', 'bat', 'cmd', 'sh', 'bin', 'app', 'jar', 'vbs', 'com', 'py', 'js'}
IMAGE_EXTS = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'webp'}
WEBSHELL_PATTERNS = [
    b'<?php', b'<%@', b'eval(', b'system(', b'exec(', b'shell_exec(',
    b'passthru(', b'assert(', b'preg_replace', b'create_function',
    b'base64_decode(', b'gzinflate(', b'str_rot13(', b'<script>'
]


def is_executable(data: bytes) -> bool:
    if len(data) >= 2 and data[:2] == b'MZ':
        if len(data) >= 0x40:
            try:
                pe_offset = int.from_bytes(data[0x3C:0x40], 'little')
                if pe_offset + 4 <= len(data) and data[pe_offset:pe_offset + 4] == b'PE\x00\x00':
                    return True
            except:
                pass
        return True

    if len(data) >= 4 and data[:4] == b'\x7fELF':
        return True

    macho_magics = [b'\xfe\xed\xfa\xce', b'\xfe\xed\xfa\xcf',
                    b'\xce\xfa\xed\xfe', b'\xcf\xfa\xed\xfe']
    return any(data.startswith(magic) for magic in macho_magics)


def contains_embedded_file(data: bytes) -> bool:
    if b'PK\x03\x04' in data:
        return True

    mz_positions = [i for i, c in enumerate(data[:-1]) if data[i:i + 2] == b'MZ']
    for pos in mz_positions:
        if pos + 0x40 <= len(data):
            try:
                pe_offset = int.from_bytes(data[pos + 0x3C:pos + 0x40], 'little')
                if pe_offset + 4 <= len(data) and data[pos + pe_offset:pos + pe_offset + 4] == b'PE\x00\x00':
                    return True
            except:
                continue

    return b'\x7fELF' in data or any(magic in data for magic in [b'\xfe\xed\xfa\xce', b'\xfe\xed\xfa\xcf'])

def contains_webshell(data: bytes) -> bool:
    return any(pattern in data for pattern in WEBSHELL_PATTERNS)

def process_file(info: zipfile.ZipInfo, data: bytes) -> str:
    ext = os.path.splitext(info.filename)[1].lower().lstrip('.')
    # if ext in EXECUTABLE_EXTS:
    #     return f"Executable extension detected: {info.filename}"
    #
    # if is_executable(data):
    #     return f"Executable content detected: {info.filename}"
    is_ext_executable = ext in EXECUTABLE_EXTS
    has_executable_content = is_executable(data)
    if not is_ext_executable and has_executable_content:
        return f"Executable content in non-executable file: {info.filename}"

    if ext in IMAGE_EXTS and contains_embedded_file(data):
        return f"Image contains embedded file: {info.filename}"

    if contains_webshell(data):
        return f"Image contains webshell code: {info.filename}"

    # try:
    #     text = data.decode('utf-8', errors='ignore').lower()
    #     for kw in SUSPICIOUS_KEYWORDS:
    #         if kw.lower() in text:
    #             return f"Suspicious keyword '{kw}' in {info.filename}"
    # except:
    #     pass

    return None


def check_zip_safety(zip_path: str) -> (bool, str):
    try:
        with zipfile.ZipFile(zip_path, 'r') as zf:
            if bad_file := zf.testzip():
                return False, f"CRC error in {bad_file}"

            entries = zf.infolist()
            if len(entries) > MAX_FILES:
                return False, f"File count exceeds {MAX_FILES}"

            file_data = {}
            total_size = 0
            for info in entries:
                if os.path.isabs(norm_path := os.path.normpath(info.filename)):
                    return False, f"Absolute path: {norm_path}"
                if '..' in norm_path.split(os.sep):
                    return False, f"Path traversal: {info.filename}"

                if (info.external_attr >> 16) & 0o170000 == 0o120000:
                    return False, f"Symlink detected: {info.filename}"

                if not info.is_dir():
                    total_size += info.file_size
                    if total_size > MAX_TOTAL_SIZE:
                        return False, f"Total size exceeds {MAX_TOTAL_SIZE} bytes"
                    try:
                        file_data[info] = zf.read(info.filename)[:SCAN_CHUNK_SIZE]
                    except Exception as e:
                        return False, f"Read failed: {info.filename} ({str(e)})"

            with ThreadPoolExecutor() as executor:
                futures = {
                    executor.submit(process_file, info, data): info
                    for info, data in file_data.items()
                }
                for future in as_completed(futures):
                    if error := future.result():
                        return False, error

            return True, None

    except zipfile.BadZipFile:
        return False, "Invalid ZIP file"
    except Exception as e:
        return False, f"System error: {str(e)}"


def main():
    if len(sys.argv) != 2:
        print(json.dumps({"result": False, "reason": "Require ZIP path"}))
        return

    result, reason = check_zip_safety(sys.argv[1])
    print(json.dumps({"result": result, "reason": reason}))


if __name__ == '__main__':
    main()
