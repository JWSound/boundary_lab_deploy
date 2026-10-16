"""Build, notarize, staple and qualify a Developer ID macOS candidate locally.

Credentials stay in Keychain. This command never publishes a release.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(*command, **kwargs):
    kwargs.setdefault("check", True)
    return subprocess.run([str(arg) for arg in command], **kwargs)


def digest(file):
    with file.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def notarize(dmg, profile):
    receipt = dmg.parent / "notarization-submission.json"
    if receipt.exists():
        submission = json.loads(receipt.read_text())
        if digest(dmg) not in {submission.get("submitted_sha256"), submission.get("stapled_sha256")}:
            raise RuntimeError("DMG changed since submission; do not reuse this notarization receipt")
    else:
        result = run("xcrun", "notarytool", "submit", dmg, "--keychain-profile", profile,
                     "--output-format", "json", capture_output=True, text=True)
        submission = json.loads(result.stdout)
        submission["submitted_sha256"] = digest(dmg)
        receipt.write_text(json.dumps(submission, indent=2) + "\n")
    submission_id = submission["id"]
    print(f"Waiting for Apple notarization: {submission_id}", flush=True)
    # If Apple takes longer, resume the same submission with --resume-dmg.
    run("xcrun", "notarytool", "wait", submission_id, "--keychain-profile", profile,
        "--timeout", "20m", check=False)
    result = run("xcrun", "notarytool", "info", submission_id, "--keychain-profile", profile,
                 "--output-format", "json", capture_output=True, text=True)
    info = json.loads(result.stdout)
    (dmg.parent / "notarization-result.json").write_text(json.dumps(info, indent=2) + "\n")
    if info["status"] == "In Progress":
        raise RuntimeError("Apple is still processing the candidate; resume later with --resume-dmg")
    run("xcrun", "notarytool", "log", submission_id, "--keychain-profile", profile,
        dmg.parent / "notarization-log.json")
    if info["status"] != "Accepted":
        raise RuntimeError("Apple rejected the candidate; see notarization-log.json")
    run("xcrun", "stapler", "staple", dmg)
    submission["stapled_sha256"] = digest(dmg)
    receipt.write_text(json.dumps(submission, indent=2) + "\n")
    run("xcrun", "stapler", "validate", dmg)
    run("codesign", "--verify", "--strict", "--verbose=2", dmg)
    run("spctl", "--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=2", dmg)
    # electron-builder's optional differential-update map predates stapling.
    # Deploy has no auto-update feed; don't leave a stale map next to the DMG.
    dmg.with_suffix(dmg.suffix + ".blockmap").unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--identity", default=os.environ.get("DEPLOY_MAC_SIGN_IDENTITY"),
                        help="Developer ID Application certificate SHA-1 fingerprint")
    parser.add_argument("--profile", default="boundary-lab-deploy-notary")
    parser.add_argument("--resources", type=Path, default=ROOT / "build/resources", help="Staged runtime to package")
    parser.add_argument("--output", type=Path, help="New output directory; never overwrite an earlier candidate")
    parser.add_argument("--resume-dmg", type=Path, help="Resume notarization/qualification of an existing candidate")
    parser.add_argument("--qualify-backends", action="store_true", help="Also qualify on physical Metal hardware")
    args = parser.parse_args()
    if sys.platform != "darwin":
        parser.error("Run on macOS")
    if args.resume_dmg:
        dmg = args.resume_dmg.resolve(strict=True)
    else:
        if not args.identity or args.identity == "-":
            parser.error("Supply --identity with a Developer ID Application certificate fingerprint")
        # Validate credential access before doing an expensive build. No password
        # is supplied on the command line or printed in build logs.
        run("xcrun", "notarytool", "history", "--keychain-profile", args.profile,
            stdout=subprocess.DEVNULL)
        output = (args.output or ROOT / "release" / datetime.now(timezone.utc).strftime("signed-%Y%m%dT%H%M%SZ")).resolve()
        output.mkdir(parents=True, exist_ok=False)
        environment = dict(os.environ, DEPLOY_MAC_SIGN_IDENTITY=args.identity,
                           DEPLOY_RUNTIME_RESOURCES=str(args.resources.resolve(strict=True)))
        run("npm", "run", "build", cwd=ROOT / "desktop", env=environment)
        run(ROOT / "desktop/node_modules/.bin/electron-builder", "--config", "electron-builder.mac.signed.cjs",
            "--mac", "--arm64", "--publish", "never", f"--config.directories.output={output}",
            cwd=ROOT / "desktop", env=environment)
        images = list(output.glob("*.dmg"))
        if len(images) != 1:
            raise RuntimeError("Expected one signed DMG")
        dmg = images[0]
    destination = dmg.parent / datetime.now(timezone.utc).strftime("Installed Test %Y%m%dT%H%M%SZ")
    command = [sys.executable, ROOT / "scripts/test_installer_macos.py", "--dmg", dmg,
               "--destination", destination, "--verify-signatures"]
    if args.qualify_backends:
        command.append("--qualify-backends")
    run(*command)
    # Qualify first so a broken first-use cache fails before uploading to Apple.
    notarize(dmg, args.profile)
    run("spctl", "--assess", "--type", "execute", "--verbose=2", destination / "Boundary Lab Deploy.app")
    checksum = digest(dmg)
    (dmg.parent / "SHA256SUMS.txt").write_text(f"{checksum}  {dmg.name}\n")
    print(f"Signed, notarized and qualified candidate: {dmg}", flush=True)


if __name__ == "__main__":
    main()
