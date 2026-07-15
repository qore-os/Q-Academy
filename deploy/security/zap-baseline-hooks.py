"""Fail-closed tuning for the pinned Q-Academy ZAP packaged scan."""


def zap_tuned(zap):
    """Undo the packaged scan's ten-alert truncation after it is applied."""
    result = zap.pscan.set_max_alerts_per_rule(0)
    if result != "OK":
        raise RuntimeError("ZAP rejected the unlimited passive-alert setting.")

    if str(zap.pscan.max_alerts_per_rule) != "0":
        raise RuntimeError("ZAP did not disable passive-alert truncation.")
