class AppConfig {
  static const String baseUrl = String.fromEnvironment('API_URL', defaultValue: 'http://72.56.244.26:47310');
  static const String apiKey = String.fromEnvironment('API_KEY', defaultValue: '');
  static const Duration requestTimeout = Duration(seconds: 30);
  static const Duration uploadTimeout = Duration(minutes: 4);
  static const double maxPhotoSide = 2560;
}
