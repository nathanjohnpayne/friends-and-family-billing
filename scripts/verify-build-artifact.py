#!/usr/bin/env python3
"""CI-only archive check; no credentials, network or deployment dispatch."""
import importlib.util
from pathlib import Path
import sys
spec = importlib.util.spec_from_file_location("verifier", Path(__file__).with_name("deploy-artifact.py"))
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)
if len(sys.argv) != 5:
    raise SystemExit("Expected archive, fresh destination, full SHA, target")
verifier.extract_verified(sys.argv[1], Path(sys.argv[2]), sys.argv[3], sys.argv[4])
print("Archive/config verification passed; no credentials acquired.")
