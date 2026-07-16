"""Fail-closed tuning for the pinned Q-Academy ZAP packaged scan."""


def zap_tuned(zap):
    """Undo supported alert truncation after packaged-scan tuning is applied."""
    result = zap.pscan.set_max_alerts_per_rule(0)
    if result != "OK":
        raise RuntimeError("ZAP rejected the unlimited passive-alert setting.")

    if str(zap.pscan.max_alerts_per_rule) != "0":
        raise RuntimeError("ZAP did not disable passive-alert truncation.")

    result = zap.core.set_option_maximum_alert_instances(0)
    if result != "OK":
        raise RuntimeError("ZAP rejected the unlimited report-instance setting.")

    if str(zap.core.option_maximum_alert_instances) != "0":
        raise RuntimeError("ZAP did not disable report-instance truncation.")
