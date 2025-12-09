#!/usr/bin/env python3
"""
Helper script to rebuild and restart the Minecraft stack without typing
multiple docker compose commands by hand.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent
COMPOSE_DIR = PROJECT_ROOT.parent.parent / "infra" / "minecraft"


def build_commands(target: str | None) -> list[list[str]]:
    # Base down command always runs
    cmds: list[list[str]] = [["docker", "compose", "down"]]

    if target == "api":
        cmds.append(["docker", "compose", "build", "--no-cache", "minecraft-api"])
        cmds.append(["docker", "compose", "up", "-d", "minecraft-api"])
    elif target == "web":
        cmds.append(["docker", "compose", "build", "--no-cache", "minecraft-web"])
        cmds.append(["docker", "compose", "up", "-d", "minecraft-web"])
    else:
        cmds.append(["docker", "compose", "build", "--no-cache"])
        cmds.append(["docker", "compose", "up", "-d"])

    return cmds


def run_steps(target: str | None) -> int:
    commands = build_commands(target)
    for cmd in commands:
        print(f"➜ Running: {' '.join(cmd)} (in {COMPOSE_DIR})")
        try:
            subprocess.run(cmd, cwd=COMPOSE_DIR, check=True)
        except subprocess.CalledProcessError as exc:
            print(f"✖ Command failed with code {exc.returncode}: {' '.join(cmd)}")
            return exc.returncode
    print("✓ Minecraft stack rebuilt and restarted.")
    return 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Rebuild and restart Minecraft stack (api/web or both)."
    )
    parser.add_argument(
        "target",
        nargs="?",
        choices=["api", "web"],
        help="Optional target to rebuild only one service. Omit to rebuild both.",
    )
    return parser.parse_args(argv)


if __name__ == "__main__":
    args = parse_args(sys.argv[1:])
    sys.exit(run_steps(args.target))
