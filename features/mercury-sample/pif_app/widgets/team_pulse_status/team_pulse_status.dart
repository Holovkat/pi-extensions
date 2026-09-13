import 'package:flutter/material.dart';
import 'package:pif/core/plugin.dart';

import '../home/team_pulse_data.dart';

class TeamPulseStatusPlugin implements PifWidgetPlugin {
  const TeamPulseStatusPlugin();
  @override
  PifWidgetMeta get meta => const PifWidgetMeta(id: 'team_pulse_status', name: 'Team Pulse Status', slot: PifSlot.status);
  @override
  Widget build(BuildContext context, PifHost host) => const _ResponsiveStatus();
}

enum _ResponsiveBand { compact, intermediate, wide }

enum _MercuryStatusTone { success, warning }

class _ResponsiveStatus extends StatelessWidget {
  const _ResponsiveStatus();

  @override
  Widget build(BuildContext context) => LayoutBuilder(
        builder: (context, constraints) {
          final band = constraints.maxWidth < 600
              ? _ResponsiveBand.compact
              : constraints.maxWidth < 1024
                  ? _ResponsiveBand.intermediate
                  : _ResponsiveBand.wide;
          return _statusFor(band);
        },
      );

  Widget _statusFor(_ResponsiveBand band) {
    final risks = teamPulseDemoSnapshot.openRisks;
    final label =
        'Team Pulse · $risks open ${risks == 1 ? 'risk' : 'risks'}';
    final badge = _MercuryStatusBadge(
      tone: risks > 0
          ? _MercuryStatusTone.warning
          : _MercuryStatusTone.success,
      label: label,
    );

    return switch (band) {
      _ResponsiveBand.compact => badge,
      _ResponsiveBand.intermediate => badge,
      _ResponsiveBand.wide => badge,
    };
  }
}

class _MercuryStatusBadge extends StatelessWidget {
  const _MercuryStatusBadge({required this.tone, required this.label});

  final _MercuryStatusTone tone;
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = _MercuryColors.of(context);
    final warning = tone == _MercuryStatusTone.warning;
    final toneColor = warning ? colors.warning : colors.success;

    return Semantics(
      container: true,
      liveRegion: warning,
      label: label,
      child: ExcludeSemantics(
        child: Container(
          padding: const EdgeInsets.symmetric(
            horizontal: _MercurySpacing.control,
            vertical: _MercurySpacing.related,
          ),
          decoration: BoxDecoration(
            color: toneColor.withValues(alpha: 0.12),
            border: Border.all(color: toneColor),
            borderRadius: BorderRadius.circular(_MercuryRadii.circular),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                warning
                    ? Icons.warning_amber_rounded
                    : Icons.check_circle_outline,
                size: 18,
                color: toneColor,
              ),
              const SizedBox(width: _MercurySpacing.related),
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: _MercuryType.label.copyWith(color: toneColor),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MercuryColors {
  const _MercuryColors({required this.success, required this.warning});

  factory _MercuryColors.of(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark
          ? darkPalette
          : lightPalette;

  final Color success;
  final Color warning;

  static const lightPalette = _MercuryColors(
    success: Color(0xFF287A55),
    warning: Color(0xFF9A5B00),
  );

  static const darkPalette = _MercuryColors(
    success: Color(0xFF75C99C),
    warning: Color(0xFFF2BE72),
  );
}

abstract final class _MercuryType {
  static const label = TextStyle(
    fontFamily: 'Poppins',
    fontFamilyFallback: ['sans-serif'],
    fontSize: 14,
    height: 1.43,
    letterSpacing: 0.1,
    fontWeight: FontWeight.w500,
  );
}

abstract final class _MercurySpacing {
  static const double related = 8;
  static const double control = 12;
}

abstract final class _MercuryRadii {
  static const double circular = 999;
}
