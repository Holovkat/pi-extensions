import 'package:flutter/material.dart';
import 'package:pif/core/plugin.dart';

import 'team_pulse_data.dart';

class HomePlugin implements PifWidgetPlugin {
  const HomePlugin();
  @override
  PifWidgetMeta get meta => const PifWidgetMeta(id: 'home', name: 'Home', slot: PifSlot.page);
  @override
  Widget build(BuildContext context, PifHost host) => const _HomePage();
}

class _HomePage extends StatelessWidget {
  const _HomePage();

  @override
  Widget build(BuildContext context) {
    final colors = _MercuryColors.of(context);

    return Scaffold(
      backgroundColor: colors.page,
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            final columns = constraints.maxWidth < 600
                ? 1
                : constraints.maxWidth < 1024
                    ? 2
                    : 4;
            final horizontalPadding = constraints.maxWidth >= 1024
                ? _MercurySpacing.page
                : _MercurySpacing.group;

            return SingleChildScrollView(
              padding: EdgeInsets.symmetric(
                horizontal: horizontalPadding,
                vertical: _MercurySpacing.page,
              ),
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 1280),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const _MercurySectionHeader(title: 'This week'),
                      LayoutBuilder(
                        builder: (context, metricConstraints) {
                          final gap = columns == 1
                              ? _MercurySpacing.group
                              : _MercurySpacing.section;
                          final metricWidth =
                              (metricConstraints.maxWidth - gap * (columns - 1)) /
                                  columns;

                          return Wrap(
                            spacing: gap,
                            runSpacing: gap,
                            children: [
                              _MercuryInsetMetric(
                                width: metricWidth,
                                label: 'Tasks done',
                                value: '${teamPulseDemoSnapshot.tasksDone}',
                              ),
                              _MercuryInsetMetric(
                                width: metricWidth,
                                label: 'In review',
                                value: '${teamPulseDemoSnapshot.inReview}',
                              ),
                              _MercuryInsetMetric(
                                width: metricWidth,
                                label: 'Cycle time',
                                value:
                                    '${teamPulseDemoSnapshot.cycleTimeDays} days',
                              ),
                              _MercuryInsetMetric(
                                width: metricWidth,
                                label: 'Open risks',
                                value: '${teamPulseDemoSnapshot.openRisks}',
                              ),
                            ],
                          );
                        },
                      ),
                      const SizedBox(height: _MercurySpacing.page),
                      const _MercurySectionHeader(title: 'Current status'),
                      _MercuryInlineNotice(
                        tone: teamPulseDemoSnapshot.openRisks > 0
                            ? _MercuryStatusTone.warning
                            : _MercuryStatusTone.success,
                        message: teamPulseDemoSnapshot.openRisks > 0
                            ? 'The team is improving, with ${teamPulseDemoSnapshot.openRisks} open risks needing attention.'
                            : 'The team is improving with no open risks.',
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

class _MercurySectionHeader extends StatelessWidget {
  const _MercurySectionHeader({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    final colors = _MercuryColors.of(context);
    return Semantics(
      header: true,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          _MercurySpacing.compact,
          0,
          _MercurySpacing.compact,
          _MercurySpacing.related,
        ),
        child: Text(
          title,
          style: _MercuryType.title.copyWith(color: colors.textHigh),
        ),
      ),
    );
  }
}

class _MercuryInsetMetric extends StatelessWidget {
  const _MercuryInsetMetric({
    required this.width,
    required this.label,
    required this.value,
  });

  final double width;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final colors = _MercuryColors.of(context);
    return Semantics(
      label: '$label, $value',
      child: ExcludeSemantics(
        child: Container(
          width: width,
          padding: const EdgeInsets.all(_MercurySpacing.related),
          decoration: BoxDecoration(
            color: colors.accentSoft.withValues(alpha: 0.42),
            borderRadius: BorderRadius.circular(_MercuryRadii.control),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                value,
                style: _MercuryType.title.copyWith(color: colors.textHigh),
              ),
              const SizedBox(height: _MercurySpacing.compact),
              Text(
                label,
                style:
                    _MercuryType.body.copyWith(color: colors.textSecondary),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

enum _MercuryStatusTone { success, warning }

class _MercuryInlineNotice extends StatelessWidget {
  const _MercuryInlineNotice({required this.tone, required this.message});

  final _MercuryStatusTone tone;
  final String message;

  @override
  Widget build(BuildContext context) => Wrap(
        children: [
          _MercuryStatusBadge(tone: tone, label: message),
        ],
      );
}

class _MercuryStatusBadge extends StatelessWidget {
  const _MercuryStatusBadge({required this.tone, required this.label});

  final _MercuryStatusTone tone;
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = _MercuryColors.of(context);
    final toneColor = tone == _MercuryStatusTone.warning
        ? colors.warning
        : colors.success;
    final icon = tone == _MercuryStatusTone.warning
        ? Icons.warning_amber_rounded
        : Icons.check_circle_outline;

    return Semantics(
      container: true,
      liveRegion: tone == _MercuryStatusTone.warning,
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
              Icon(icon, size: 18, color: toneColor),
              const SizedBox(width: _MercurySpacing.related),
              Flexible(
                child: Text(
                  label,
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
  const _MercuryColors({
    required this.page,
    required this.accent,
    required this.accentSoft,
    required this.textHigh,
    required this.textSecondary,
    required this.success,
    required this.warning,
  });

  factory _MercuryColors.of(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return dark ? darkPalette : lightPalette;
  }

  final Color page;
  final Color accent;
  final Color accentSoft;
  final Color textHigh;
  final Color textSecondary;
  final Color success;
  final Color warning;

  static const lightPalette = _MercuryColors(
    page: Color(0xFFEEF1F8),
    accent: Color(0xFF397C76),
    accentSoft: Color(0xFFCFE5E2),
    textHigh: Color(0xFF202329),
    textSecondary: Color(0xFF555C66),
    success: Color(0xFF287A55),
    warning: Color(0xFF9A5B00),
  );

  static const darkPalette = _MercuryColors(
    page: Color(0xFF24252A),
    accent: Color(0xFF78B8B0),
    accentSoft: Color(0xFF365A57),
    textHigh: Color(0xFFF2F3F7),
    textSecondary: Color(0xFFC5C7CE),
    success: Color(0xFF75C99C),
    warning: Color(0xFFF2BE72),
  );
}

abstract final class _MercuryType {
  static const title = TextStyle(
    fontFamily: 'Poppins',
    fontFamilyFallback: ['sans-serif'],
    fontSize: 22,
    height: 1.27,
    fontWeight: FontWeight.w500,
  );

  static const body = TextStyle(
    fontFamily: 'Poppins',
    fontFamilyFallback: ['sans-serif'],
    fontSize: 16,
    height: 1.5,
    letterSpacing: 0.5,
    fontWeight: FontWeight.w400,
  );

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
  static const double compact = 4;
  static const double related = 8;
  static const double control = 12;
  static const double group = 16;
  static const double section = 24;
  static const double page = 32;
}

abstract final class _MercuryRadii {
  static const double control = 12;
  static const double circular = 999;
}
