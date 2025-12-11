"""
Orchestrator package.

This package exposes the same public API that previously lived in
backend/orchestrator.py, but the implementation now resides in
backend/orchestrator/core.py.

All existing imports like:

    from backend.orchestrator import create_instance

will continue to work.
"""

from .core import *  # re-export everything from core

__all__ = [name for name in globals().keys() if not name.startswith("_")]
