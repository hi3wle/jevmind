"""Synthetic acceptance fixture. The clamp defect is intentional."""


def greeting(name):
    return f"Hello, {name}!"


def clamp(value, lower, upper):
    return min(lower, max(upper, value))
