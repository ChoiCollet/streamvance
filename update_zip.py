#!/usr/bin/env python3
import os
import zipfile

def create_streamvance_zip():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    zip_filename = os.path.join(base_dir, 'streamvance.zip')
    
    # 포함할 파일 및 폴더 목록
    include_paths = [
        'index.html',
        'manifest.json',
        'README.md',
        '.gitignore',
        'server.py',
        'css',
        'js',
        'functions',
        'public',
        'src'
    ]
    
    exclude_patterns = [
        '__pycache__',
        'desktop.ini',
        '.DS_Store',
        'streamvance.zip',
        'update_zip.py'
    ]

    print(f"Creating zip file: {zip_filename}")
    with zipfile.ZipFile(zip_filename, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for item in include_paths:
            full_item_path = os.path.join(base_dir, item)
            if not os.path.exists(full_item_path):
                continue
                
            if os.path.isfile(full_item_path):
                arcname = item
                zipf.write(full_item_path, arcname)
                print(f"Added file: {arcname}")
            elif os.path.isdir(full_item_path):
                for root, dirs, files in os.walk(full_item_path):
                    # 제외 패턴 필터링
                    dirs[:] = [d for d in dirs if not any(p in d for p in exclude_patterns)]
                    for file in files:
                        if any(p in file for p in exclude_patterns):
                            continue
                        file_path = os.path.join(root, file)
                        arcname = os.path.relpath(file_path, base_dir).replace('\\', '/')
                        zipf.write(file_path, arcname)
                        print(f"Added: {arcname}")

    file_size_kb = os.path.getsize(zip_filename) / 1024
    print(f"Done! Created streamvance.zip ({file_size_kb:.1f} KB)")

if __name__ == '__main__':
    create_streamvance_zip()
