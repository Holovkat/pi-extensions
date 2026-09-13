enum WeekOnWeekDirection { improving, steady, declining }

class TeamPulseSnapshot {
  const TeamPulseSnapshot({
    required this.tasksDone,
    required this.inReview,
    required this.cycleTimeDays,
    required this.openRisks,
    required this.tasksDoneDirection,
    required this.inReviewDirection,
    required this.cycleTimeDirection,
    required this.risksDirection,
  });

  final int tasksDone;
  final int inReview;
  final double cycleTimeDays;
  final int openRisks;
  final WeekOnWeekDirection tasksDoneDirection;
  final WeekOnWeekDirection inReviewDirection;
  final WeekOnWeekDirection cycleTimeDirection;
  final WeekOnWeekDirection risksDirection;
}

const teamPulseDemoSnapshot = TeamPulseSnapshot(
  tasksDone: 24,
  inReview: 6,
  cycleTimeDays: 2.4,
  openRisks: 2,
  tasksDoneDirection: WeekOnWeekDirection.improving,
  inReviewDirection: WeekOnWeekDirection.improving,
  cycleTimeDirection: WeekOnWeekDirection.improving,
  risksDirection: WeekOnWeekDirection.improving,
);
