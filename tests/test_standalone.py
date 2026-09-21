"""Prove the installed service works outside either application checkout."""
import json
import os
import subprocess
import sys


def test_no_boundary_lab_imports(tmp_path):
    code = """
import importlib.abc, sys
class NoBoundaryLab(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname == 'blab' or fullname.startswith('blab.'):
            raise AssertionError('Boundary Lab import: ' + fullname)
sys.meta_path.insert(0, NoBoundaryLab())
import boundary_deploy.worker
import boundary_deploy.solve
import boundary_deploy.assets
print('independent')
"""
    result = subprocess.run([sys.executable, '-I', '-c', code], cwd=tmp_path,
                            capture_output=True, text=True, timeout=30, check=True)
    assert result.stdout.strip() == 'independent'


def test_installed_worker_protocol_from_unrelated_directory(tmp_path):
    environment = {key: value for key, value in os.environ.items() if key != 'PYTHONPATH'}
    result = subprocess.run([sys.executable, '-I', '-m', 'boundary_deploy.worker'], cwd=tmp_path,
                            env=environment, input='{"id":7,"operation":"invalid"}\n',
                            capture_output=True, text=True, timeout=30, check=True)
    events = [json.loads(line) for line in result.stdout.splitlines()]
    assert events[0]['type'] == 'ready'
    assert events[0]['protocol'] == 'boundary_lab_deploy_worker'
    assert events[1]['type'] == 'failed'
    assert events[1]['id'] == 7
