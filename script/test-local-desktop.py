#!/usr/bin/env python3
"""Focused offline tests for the local Dock deployment lifecycle."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest import mock


SCRIPT = Path(__file__).with_name('local-desktop.py')


def load_script():
    spec = importlib.util.spec_from_file_location('local_desktop_test_subject', SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class LocalDesktopTests(unittest.TestCase):
    def setUp(self):
        self.local_desktop = load_script()

    def configure_paths(self, root):
        source = root / 'source'
        state = root / 'state'
        source.mkdir()
        state.mkdir()
        (source / 'github-desktop').write_bytes(b'build')
        self.local_desktop.SOURCE = source
        self.local_desktop.STATE = state
        self.local_desktop.CURRENT = state / 'current'
        self.local_desktop.ENTRY = root / 'applications/github-desktop-local.desktop'

    def test_deploy_refreshes_stale_launcher_before_stopping_app(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.configure_paths(root)
            self.local_desktop.ENTRY.parent.mkdir()
            self.local_desktop.ENTRY.write_text('StartupWMClass=GitHub Desktop\n')
            events = []
            states = iter(([1234], []))
            install = self.local_desktop.install_launcher

            def refresh_launcher():
                events.append('refresh')
                install()

            def running():
                events.append('running')
                return next(states)

            with mock.patch.object(self.local_desktop.shutil, 'which', return_value=None), \
                    mock.patch.object(self.local_desktop, 'install_launcher', side_effect=refresh_launcher), \
                    mock.patch.object(self.local_desktop, 'running', side_effect=running), \
                    mock.patch.object(self.local_desktop.os, 'kill', side_effect=lambda *_: events.append('kill')), \
                    mock.patch.object(self.local_desktop.subprocess, 'Popen', side_effect=lambda *_args, **_kwargs: events.append('launch')):
                self.local_desktop.deploy()

            self.assertLess(events.index('refresh'), events.index('kill'))
            self.assertLess(events.index('kill'), events.index('launch'))
            launcher = self.local_desktop.ENTRY.read_text()
            self.assertIn(f'StartupWMClass={self.local_desktop.APP_NAME}', launcher)
            self.assertNotIn('StartupWMClass=GitHub Desktop', launcher)

    def test_launcher_failure_does_not_stop_running_app(self):
        with tempfile.TemporaryDirectory() as directory:
            self.configure_paths(Path(directory))
            running = mock.Mock(side_effect=AssertionError('running app must not be inspected'))
            kill = mock.Mock()
            with mock.patch.object(self.local_desktop, 'install_launcher', side_effect=RuntimeError('launcher failed')), \
                    mock.patch.object(self.local_desktop, 'running', running), \
                    mock.patch.object(self.local_desktop.os, 'kill', kill):
                with self.assertRaisesRegex(RuntimeError, 'launcher failed'):
                    self.local_desktop.deploy()
            running.assert_not_called()
            kill.assert_not_called()


if __name__ == '__main__':
    unittest.main()
