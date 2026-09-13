import 'package:flutter/material.dart';
import 'package:pif/core/plugin.dart';

import '../home/team_pulse_data.dart';

class MetricsPlugin implements PifWidgetPlugin {
  const MetricsPlugin();
  @override
  PifWidgetMeta get meta => const PifWidgetMeta(id: 'metrics', name: 'Metrics', slot: PifSlot.page);
  @override
  Widget build(BuildContext context, PifHost host) => const _MetricsPage();
}

class _MetricsPage extends StatelessWidget {
  const _MetricsPage();

  @override
  Widget build(BuildContext context) {
    final colors = _MercuryColors.of(context);
    final metrics = <_MetricDetail>[
      _MetricDetail(
        icon: Icons.task_alt,
        label: 'Tasks done',
        value: '${teamPulseDemoSnapshot.tasksDone}',
        direction: teamPulseDemoSnapshot.tasksDoneDirection,
        improvingLabel: 'Up this week',
        decliningLabel: 'Down this week',
        explanation: 'Four more tasks were completed than last week.',
      ),
      _MetricDetail(
        icon: Icons.rate_review_outlined,
        label: 'In review',
        value: '${teamPulseDemoSnapshot.inReview}',
        direction: teamPulseDemoSnapshot.inReviewDirection,
        improvingLabel: 'Up this week',
        decliningLabel: 'Down this week',
        explanation: 'Two more tasks are moving through review.',
      ),
      _MetricDetail(
        icon: Icons.schedule,
        label: 'Cycle time',
        value: '${teamPulseDemoSnapshot.cycleTimeDays} days',
        direction: teamPulseDemoSnapshot.cycleTimeDirection,
        improvingLabel: 'Down this week',
        decliningLabel: 'Up this week',
        explanation: 'Work is completing 0.3 days faster.',
      ),
      _MetricDetail(
        icon: Icons.warning_amber_rounded,
        label: 'Open risks',
        value: '${teamPulseDemoSnapshot.openRisks}',
        direction: teamPulseDemoSnapshot.risksDirection,
        improvingLabel: 'Down this week',
        decliningLabel: 'Up this week',
        explanation: 'One fewer risk remains open.',
      ),
    ];

    return Scaffold(
      backgroundColor: colors.page,
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            final compact = constraints.maxWidth < 600;

            return SingleChildScrollView(
              padding: const EdgeInsets.all(_MercurySpacing.page),
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 1280),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const _MercurySectionHeader(title: 'This week'),
                      DecoratedBox(
                        decoration: BoxDecoration(
                          color: colors.surface,
                          borderRadius:
                              BorderRadius.circular(_MercuryRadii.group),
                        ),
                        child: compact
                            ? _CompactMetricList(metrics: metrics)
                            : _TwoColumnMetricList(metrics: metrics),
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

class _MetricDetail {
  const _MetricDetail({
    required this.icon,
    required this.label,
    required this.value,
    required this.direction,
    required this.improvingLabel,
    required this.decliningLabel,
    required this.explanation,
  });

  final IconData icon;
  final String label;
  final String value;
  final WeekOnWeekDirection direction;
  final String improvingLabel;
  final String decliningLabel;
  final String explanation;
}

class _CompactMetricList extends StatelessWidget {
  const _CompactMetricList({required this.metrics});

  final List<_MetricDetail> metrics;

  @override
  Widget build(BuildContext context) => Column(
        children: [
          for (var index = 0; index < metrics.length; index++) ...[
            _MetricDetailItem(metric: metrics[index]),
            if (index < metrics.length - 1) const _MercuryDivider(),
          ],
        ],
      );
}

class _TwoColumnMetricList extends StatelessWidget {
  const _TwoColumnMetricList({required this.metrics});

  final List<_MetricDetail> metrics;

  @override
  Widget build(BuildContext context) => Column(
        children: [
          _MetricPair(first: metrics[0], second: metrics[1]),
          const _MercuryDivider(),
          _MetricPair(first: metrics[2], second: metrics[3]),
        ],
      );
}

class _MetricPair extends StatelessWidget {
  const _MetricPair({required this.first, required this.second});

  final _MetricDetail first;
  final _MetricDetail second;

  @override
  Widget build(BuildContext context) => IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(child: _MetricDetailItem(metric: first)),
            const _MercuryVerticalDivider(),
            Expanded(child: _MetricDetailItem(metric: second)),
          ],
        ),
      );
}

class _MetricDetailItem extends StatelessWidget {
  const _MetricDetailItem({required this.metric});

  final _MetricDetail metric;

  @override
  Widget build(BuildContext context) {
    final colors = _MercuryColors.of(context);
    return Semantics(
      container: true,
      label:
          '${metric.label}, ${metric.value}. ${_directionLabel(metric)}. ${metric.explanation}',
      child: ExcludeSemantics(
        child: Padding(
          padding: const EdgeInsets.all(_MercurySpacing.group),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _MercuryMetricValueRow(
                icon: metric.icon,
                label: metric.label,
                value: metric.value,
              ),
              const SizedBox(height: _MercurySpacing.control),
              _MercuryStatusBadge(
                tone: _directionTone(metric.direction),
                label: _directionLabel(metric),
              ),
              const SizedBox(height: _MercurySpacing.related),
              Text(
                metric.explanation,
                style: _MercuryType.body.copyWith(
                  color: colors.textSecondary,
                ),
              ),
            ],
          ),
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

class _MercuryMetricValueRow extends StatelessWidget {
  const _MercuryMetricValueRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final colors = _MercuryColors.of(context);
    return Wrap(
      spacing: _MercurySpacing.related,
      runSpacing: _MercurySpacing.compact,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        Icon(icon, size: 20, color: colors.accent),
        Text(
          label,
          style: _MercuryType.body.copyWith(color: colors.textHigh),
        ),
        Text(
          value,
          style: _MercuryType.title.copyWith(color: colors.textHigh),
        ),
      ],
    );
  }
}

enum _MercuryStatusTone { neutral, success, warning }

class _MercuryStatusBadge extends StatelessWidget {
  const _MercuryStatusBadge({required this.tone, required this.label});

  final _MercuryStatusTone tone;
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = _MercuryColors.of(context);
    final toneColor = switch (tone) {
      _MercuryStatusTone.neutral => colors.accent,
      _MercuryStatusTone.success => colors.success,
      _MercuryStatusTone.warning => colors.warning,
    };
    final icon = switch (tone) {
      _MercuryStatusTone.neutral => Icons.info_outline,
      _MercuryStatusTone.success => Icons.check_circle_outline,
      _MercuryStatusTone.warning => Icons.warning_amber_rounded,
    };

    return Semantics(
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
              Text(
                label,
                style: _MercuryType.label.copyWith(color: toneColor),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MercuryDivider extends StatelessWidget {
  const _MercuryDivider();

  @override
  Widget build(BuildContext context) => Divider(
        height: 1,
        thickness: 1,
        indent: _MercurySpacing.group,
        endIndent: _MercurySpacing.group,
        color: _MercuryColors.of(context).divider,
      );
}

class _MercuryVerticalDivider extends StatelessWidget {
  const _MercuryVerticalDivider();

  @override
  Widget build(BuildContext context) => VerticalDivider(
        width: 1,
        thickness: 1,
        indent: _MercurySpacing.group,
        endIndent: _MercurySpacing.group,
        color: _MercuryColors.of(context).divider,
      );
}

_MercuryStatusTone _directionTone(WeekOnWeekDirection direction) =>
    switch (direction) {
      WeekOnWeekDirection.improving => _MercuryStatusTone.success,
      WeekOnWeekDirection.steady => _MercuryStatusTone.neutral,
      WeekOnWeekDirection.declining => _MercuryStatusTone.warning,
    };

String _directionLabel(_MetricDetail metric) => switch (metric.direction) {
      WeekOnWeekDirection.improving => metric.improvingLabel,
      WeekOnWeekDirection.steady => 'Steady this week',
      WeekOnWeekDirection.declining => metric.decliningLabel,
    };

class _MercuryColors {
  const _MercuryColors({
    required this.page,
    required this.surface,
    required this.accent,
    required this.divider,
    required this.textHigh,
    required this.textSecondary,
    required this.success,
    required this.warning,
  });

  factory _MercuryColors.of(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark
          ? darkPalette
          : lightPalette;

  final Color page;
  final Color surface;
  final Color accent;
  final Color divider;
  final Color textHigh;
  final Color textSecondary;
  final Color success;
  final Color warning;

  static const lightPalette = _MercuryColors(
    page: Color(0xFFEEF1F8),
    surface: Color(0xFFF8FAFE),
    accent: Color(0xFF397C76),
    divider: Color(0xFFD9DEE8),
    textHigh: Color(0xFF202329),
    textSecondary: Color(0xFF555C66),
    success: Color(0xFF287A55),
    warning: Color(0xFF9A5B00),
  );

  static const darkPalette = _MercuryColors(
    page: Color(0xFF24252A),
    surface: Color(0xFF35383F),
    accent: Color(0xFF78B8B0),
    divider: Color(0xFF4B4E57),
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
  static const double page = 32;
}

abstract final class _MercuryRadii {
  static const double group = 20;
  static const double circular = 999;
}
