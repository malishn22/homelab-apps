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


def prune_docker(aggressive: bool = False) -> None:
    """
    Clean up unused Docker data to avoid 'no space left on device'.

    aggressive=False:
        - prune dangling images & build cache (safe for normal use)
    aggressive=True:
        - docker system prune --volumes (removes ALL unused volumes, networks, images, containers)
    """
    commands: list[list[str]] = [
        ["docker", "image", "prune", "-f"],
        ["docker", "builder", "prune", "-f"],
    ]

    if aggressive:
        commands.append(["docker", "system", "prune", "-f", "--volumes"])

    for cmd in commands:
        print(f"➜ Pruning: {' '.join(cmd)}")
        try:
            subprocess.run(cmd, check=True)
        except subprocess.CalledProcessError as exc:
            print(f"✖ Prune command failed ({exc.returncode}): {' '.join(cmd)}")
            # Do not abort script because prune failed


def build_commands(target: str | None) -> list[list[str]]:
    # Base down command always runs
    cmds: list[list[str]] = [["docker", "compose", "down"]]

    if target == "api":
        cmds.append(["docker", "compose", "up", "-d", "minecraft-api"])
    elif target == "web":
        cmds.append(["docker", "compose", "up", "-d", "minecraft-web"])
    else:
        cmds.append(["docker", "compose", "up", "-d", "--build"])

    return cmds


def run_steps(target: str | None, aggressive_prune: bool = False) -> int:
    commands = build_commands(target)

    for idx, cmd in enumerate(commands):
        print(f"➜ Running: {' '.join(cmd)} (in {COMPOSE_DIR})")
        try:
            subprocess.run(cmd, cwd=COMPOSE_DIR, check=True)
        except subprocess.CalledProcessError as exc:
            print(f"✖ Command failed with code {exc.returncode}: {' '.join(cmd)}")
            return exc.returncode

        # After docker compose down (first command), optionally prune (only if --prune passed)
        if idx == 0 and aggressive_prune:
            prune_docker(aggressive=True)

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
    parser.add_argument(
        "--prune",
        action="store_true",
        help="Aggressively prune unused Docker data (includes volumes).",
    )
    return parser.parse_args(argv)


if __name__ == "__main__":
    args = parse_args(sys.argv[1:])
    sys.exit(run_steps(args.target, aggressive_prune=args.prune))
