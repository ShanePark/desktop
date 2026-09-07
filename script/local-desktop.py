#!/usr/bin/env python3
"""Keep the Dock app available during builds; deploy and restart on success."""
import fcntl
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT / '.local-desktop'
SOURCE = ROOT / 'dist/github-desktop-linux-x64'
CURRENT = STATE / 'current'
ENTRY = Path.home() / '.local/share/applications/github-desktop-local.desktop'


def running():
    result = []
    for proc in Path('/proc').glob('[0-9]*'):
        try:
            executable = os.readlink(proc / 'exe').removesuffix(' (deleted)')
            # Electron may rewrite argv into a single space-separated title.
            args = (proc / 'cmdline').read_bytes().replace(b'\0', b' ').split()
            ours = (executable == str(SOURCE / 'github-desktop') or
                    executable.startswith(str(STATE) + '/'))
            if ours and Path(executable).name == 'github-desktop' and not any(
                arg.startswith(b'--type=') for arg in args
            ):
                result.append(int(proc.name))
        except (OSError, PermissionError):
            continue
    return result


def deploy():
    if not (SOURCE / 'github-desktop').is_file():
        raise RuntimeError('No packaged build found. Run yarn build:local first.')
    release = STATE / ('release-' + uuid.uuid4().hex)
    print('Preparing Dock app…', flush=True)
    shutil.copytree(SOURCE, release)
    # Prepare everything before stopping the current app.
    for pid in running():
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    deadline = time.monotonic() + 20
    while running():
        if time.monotonic() > deadline:
            shutil.rmtree(release)
            raise RuntimeError('App did not exit; close it and run deploy again.')
        time.sleep(0.2)
    previous = CURRENT.resolve() if CURRENT.exists() else None
    pending = STATE / 'next'
    pending.unlink(missing_ok=True)
    pending.symlink_to(release.name)
    pending.replace(CURRENT)
    # Keep one previous release; never remove the source build.
    for old in STATE.glob('release-*'):
        if old not in (release, previous):
            shutil.rmtree(old)
    with (STATE / 'launch.log').open('ab') as log:
        subprocess.Popen(
            ['/usr/bin/python3', str(Path(__file__).resolve()), 'launch'],
            stdin=subprocess.DEVNULL, stdout=log, stderr=log,
            start_new_session=True,
        )
    print('Dock app updated; restart requested.', flush=True)


def install_launcher():
    ENTRY.parent.mkdir(parents=True, exist_ok=True)
    if ENTRY.exists() and not ENTRY.with_suffix('.desktop.bak').exists():
        shutil.copy2(ENTRY, ENTRY.with_suffix('.desktop.bak'))
    ENTRY.write_text(f'''[Desktop Entry]
Name=GitHub Desktop (Local Build)
Comment=GitHub Desktop with local repository activity changes
GenericName=GitHub Desktop
Exec=/usr/bin/python3 "{ROOT}/script/local-desktop.py" launch %U
Icon={ROOT}/app/static/linux/logos/512x512.png
Path={ROOT}
Type=Application
StartupNotify=true
Categories=GNOME;GTK;Development;
MimeType=x-scheme-handler/x-github-client;
StartupWMClass=GitHub Desktop
Terminal=false
X-GNOME-UsesNotifications=true
''')
    if shutil.which('update-desktop-database'):
        subprocess.run(['update-desktop-database', str(ENTRY.parent)], check=True)


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else 'launch'
    if command not in ('launch', 'deploy', 'rebuild', 'install'):
        raise RuntimeError('Usage: local-desktop.py [launch|deploy|rebuild|install]')
    STATE.mkdir(exist_ok=True)
    # Launches stay available while compilation runs.
    if command == 'rebuild':
        with (STATE / 'build.lock').open('w') as build_lock:
            fcntl.flock(build_lock, fcntl.LOCK_EX)
            subprocess.run(['yarn', 'build:prod'], cwd=ROOT, check=True)
            with (STATE / 'deploy.lock').open('w') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                deploy()
        return
    with (STATE / 'deploy.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if command == 'launch':
            executable = CURRENT.resolve() / 'github-desktop'
            if not executable.is_file():
                raise RuntimeError('Run yarn build:local to prepare the Dock app.')
        else:
            if command == 'install':
                install_launcher()
            deploy()
            return
    os.chdir(ROOT)
    os.execv(executable, [str(executable), *sys.argv[2:]])


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f'Local Desktop: {error}', file=sys.stderr)
        sys.exit(1)
