import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'core/theme.dart';
import 'data/app_state.dart';
import 'features/login.dart';
import 'features/shell.dart';

class HrisApp extends StatelessWidget {
  const HrisApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider(
      create: (_) => AppState(),
      child: Consumer<AppState>(
        builder: (context, app, _) {
          return AnimatedTheme(
            data: app.themeMode == ThemeMode.dark
                ? AppTheme.dark()
                : app.themeMode == ThemeMode.light
                    ? AppTheme.light()
                    : (MediaQuery.platformBrightnessOf(context) == Brightness.dark
                        ? AppTheme.dark()
                        : AppTheme.light()),
            child: MaterialApp(
              title: 'OneVity HRIS',
              debugShowCheckedModeBanner: false,
              theme: AppTheme.light(),
              darkTheme: AppTheme.dark(),
              themeMode: app.themeMode,
              home: AnimatedSwitcher(
                duration: const Duration(milliseconds: 350),
                child: app.loggedIn
                    ? const MainShell(key: ValueKey('shell'))
                    : const LoginGate(key: ValueKey('login')),
              ),
            ),
          );
        },
      ),
    );
  }
}
