import 'package:flutter/material.dart';

/// Pinned template appearance for generated app-mode surfaces (#212).
///
/// The app manifest (`pif_app/app.yaml`) may pin a template id; when the
/// shell renders in app mode, a recognized template swaps the surrounding
/// Material theme for the template's paired semantic tokens. The IDE theme
/// and projects without a recognized template are untouched. Page and
/// navigation widgets consume `Theme.of(context)`, so no sample-only
/// override or second design system is introduced.
///
/// Token values come from the template's validated `design.json` (the
/// documented semantic palette binds per the Mercury authority chain).
abstract class TemplateAppearance {
  ThemeData materialTheme(Brightness brightness);
}

/// Returns the pinned appearance for a manifest template id, or null when
/// the manifest has no template or pins an unknown one (safe fallback to
/// the stock appearance).
TemplateAppearance? templateAppearanceFor(String? template) {
  if (template == null || template.isEmpty) return null;
  if (template == 'mercury') return const MercuryTemplateAppearance();
  return null;
}

/// FMS Mercury — calm wayfinding surfaces. Documented semantic palette
/// (light + dark pairs), typography roles capped at weight 500, radii
/// 8/12/20/999, flat tonal-first hierarchy.
class MercuryTemplateAppearance implements TemplateAppearance {
  const MercuryTemplateAppearance();

  // colors.roles — documented light/dark pairs from design.json.
  static const _page = Color(0xffEEF1F8), _pageDark = Color(0xff24252A);
  static const _surface = Color(0xffF8FAFE), _surfaceDark = Color(0xff35383F);
  static const _surfaceRaised = Color(0xffFFFFFF),
      _surfaceRaisedDark = Color(0xff3D4049);
  static const _navigation = Color(0xffFFFFFF),
      _navigationDark = Color(0xff303136);
  static const _accent = Color(0xff397C76), _accentDark = Color(0xff78B8B0);
  static const _accentSoft = Color(0xffCFE5E2),
      _accentSoftDark = Color(0xff365A57);
  static const _divider = Color(0xffD9DEE8), _dividerDark = Color(0xff4B4E57);
  static const _textHigh = Color(0xff202329), _textHighDark = Color(0xffF2F3F7);
  static const _textSecondary = Color(0xff555C66),
      _textSecondaryDark = Color(0xffC5C7CE);
  static const _textOnAccent = Color(0xffFFFFFF),
      _textOnAccentDark = Color(0xff102A28);
  static const _error = Color(0xffB3261E), _errorDark = Color(0xffFFB4AB);

  /// Semantic status tones from design.json. Material has no success or
  /// warning slot, so template status components (#206) resolve these per
  /// appearance alongside `Theme.of(context)`.
  static Color success(Brightness brightness) =>
      brightness == Brightness.dark ? _successDark : _success;
  static Color warning(Brightness brightness) =>
      brightness == Brightness.dark ? _warningDark : _warning;
  static const _successDark = Color(0xff75C99C), _success = Color(0xff287A55);
  static const _warningDark = Color(0xffF2BE72), _warning = Color(0xff9A5B00);

  // tokens.radii / tokens.spacing.named — pinned geometry rhythm, shared
  // with template component work (#206) so pages never restate values.
  static const double radiusChip = 8;
  static const double radiusControl = 12;
  static const double radiusGroup = 20;
  static const double spacingCompact = 4;
  static const double spacingRelated = 8;
  static const double spacingControl = 12;
  static const double spacingGroup = 16;
  static const double spacingSection = 24;
  static const double spacingPage = 32;

  @override
  ThemeData materialTheme(Brightness brightness) {
    final dark = brightness == Brightness.dark;
    Color role(Color light, Color darkValue) => dark ? darkValue : light;
    final page = role(_page, _pageDark);
    final surface = role(_surface, _surfaceDark);
    final surfaceRaised = role(_surfaceRaised, _surfaceRaisedDark);
    final navigation = role(_navigation, _navigationDark);
    final accent = role(_accent, _accentDark);
    final accentSoft = role(_accentSoft, _accentSoftDark);
    final divider = role(_divider, _dividerDark);
    final textHigh = role(_textHigh, _textHighDark);
    final textSecondary = role(_textSecondary, _textSecondaryDark);
    final textOnAccent = role(_textOnAccent, _textOnAccentDark);
    final error = role(_error, _errorDark);
    final hairline = BorderSide(color: divider);

    // Typography roles from design.json (No-Bold cap at 500; Poppins by
    // name with the documented sans-serif fallback when not vendored).
    TextStyle textRole(TextStyle? base,
            {required double size,
            required FontWeight weight,
            required double height,
            double letterSpacing = 0}) =>
        (base ?? const TextStyle()).copyWith(
          fontSize: size,
          fontWeight: weight,
          height: height,
          letterSpacing: letterSpacing,
          color: textHigh,
        );
    final baseTheme = ThemeData(brightness: brightness).textTheme;
    final textTheme = baseTheme.copyWith(
      headlineMedium: textRole(baseTheme.headlineMedium,
          size: 32, weight: FontWeight.w500, height: 1.25),
      titleLarge: textRole(baseTheme.titleLarge,
          size: 22, weight: FontWeight.w500, height: 1.27),
      bodyLarge: textRole(baseTheme.bodyLarge,
          size: 16, weight: FontWeight.w400, height: 1.5, letterSpacing: 0.5),
      bodyMedium: textRole(baseTheme.bodyMedium,
          size: 16, weight: FontWeight.w400, height: 1.5, letterSpacing: 0.5),
      labelLarge: textRole(baseTheme.labelLarge,
          size: 14, weight: FontWeight.w500, height: 1.43, letterSpacing: 0.1),
      labelMedium: textRole(baseTheme.labelMedium,
          size: 14, weight: FontWeight.w500, height: 1.43, letterSpacing: 0.1),
    );

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      scaffoldBackgroundColor: page,
      colorScheme: ColorScheme.fromSeed(
        seedColor: accent,
        brightness: brightness,
      ).copyWith(
        primary: accent,
        onPrimary: textOnAccent,
        secondary: accent,
        onSecondary: textOnAccent,
        surface: surface,
        onSurface: textHigh,
        onSurfaceVariant: textSecondary,
        outline: divider,
        outlineVariant: divider,
        error: error,
        surfaceContainerHighest: surfaceRaised,
      ),
      dividerColor: divider,
      dividerTheme: DividerThemeData(color: divider, thickness: 1, space: 1),
      appBarTheme: AppBarTheme(
        backgroundColor: page,
        foregroundColor: textHigh,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: true,
      ),
      cardTheme: CardThemeData(
        color: surface,
        elevation: 2,
        shadowColor: Colors.black.withValues(alpha: 0.1),
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusGroup),
        ),
        margin: EdgeInsets.zero,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: navigation,
        indicatorColor: accentSoft,
        elevation: 0,
        surfaceTintColor: Colors.transparent,
        iconTheme: WidgetStateProperty.resolveWith(
          (states) => IconThemeData(
            color: states.contains(WidgetState.selected)
                ? accent
                : textSecondary,
          ),
        ),
      ),
      navigationRailTheme: NavigationRailThemeData(
        backgroundColor: navigation,
        indicatorColor: accentSoft,
        selectedIconTheme: IconThemeData(color: accent),
        unselectedIconTheme: IconThemeData(color: textSecondary),
        selectedLabelTextStyle: TextStyle(
          color: accent,
          fontSize: 14,
          fontWeight: FontWeight.w500,
        ),
        unselectedLabelTextStyle: TextStyle(
          color: textSecondary,
          fontSize: 14,
          fontWeight: FontWeight.w400,
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: accent,
          foregroundColor: textOnAccent,
          elevation: 1,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(radiusControl),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: accent,
          side: BorderSide(color: accent),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(radiusControl),
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: accent,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(radiusControl),
          ),
        ),
      ),
      inputDecorationTheme: InputDecorationThemeData(
        filled: true,
        fillColor: surfaceRaised,
        contentPadding: const EdgeInsets.all(spacingGroup),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusControl),
          borderSide: hairline,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusControl),
          borderSide: hairline,
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusControl),
          borderSide: BorderSide(color: accent, width: 2),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusControl),
          borderSide: BorderSide(color: error, width: 2),
        ),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: surface,
        selectedColor: accentSoft,
        side: hairline,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusChip),
        ),
        labelStyle: TextStyle(color: textHigh, fontSize: 14),
      ),
      snackBarTheme: const SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
      ),
      textTheme: textTheme,
      iconTheme: IconThemeData(color: textHigh),
    );
  }
}
