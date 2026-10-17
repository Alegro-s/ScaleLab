import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'package:flutter/painting.dart' show Offset;
import 'package:image_picker/image_picker.dart';

import 'config.dart';
import 'models.dart';
import 'wizard_models.dart';

class ApiException implements Exception {
  const ApiException(this.message);

  final String message;

  @override
  String toString() => message;
}

class Api {
  Api({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;

  Map<String, String> get _headers => AppConfig.apiKey.isEmpty ? <String, String>{} : {'x-api-key': AppConfig.apiKey};

  Map<String, String> get imageHeaders => _headers;

  Uri _uri(String path, [Map<String, String>? query]) {
    final q = <String, String>{...?query};
    return Uri.parse('${AppConfig.baseUrl}/api$path').replace(queryParameters: q.isEmpty ? null : q);
  }

  Uri fileUri(String id, String format) {
    final q = <String, String>{'format': format};
    if (AppConfig.apiKey.isNotEmpty) q['key'] = AppConfig.apiKey;
    return _uri('/m/reports/$id/file', q);
  }

  Uri previewUri(String id, int slot) => _uri('/m/reports/$id/preview/$slot');

  Future<T> _guard<T>(Future<T> Function() run) async {
    try {
      return await run();
    } on ApiException {
      rethrow;
    } on SocketException {
      throw const ApiException('Нет связи с сервером. Проверьте интернет и адрес сервера.');
    } on TimeoutException {
      throw const ApiException('Сервер не ответил вовремя. Попробуйте ещё раз.');
    } on http.ClientException {
      throw const ApiException('Не удалось связаться с сервером.');
    } on FormatException {
      throw const ApiException('Сервер вернул непонятный ответ.');
    }
  }

  dynamic _decode(http.Response r) {
    if (r.statusCode >= 200 && r.statusCode < 300) {
      return r.body.isEmpty ? null : jsonDecode(utf8.decode(r.bodyBytes));
    }
    var message = 'Ошибка сервера (${r.statusCode})';
    try {
      final j = jsonDecode(utf8.decode(r.bodyBytes));
      if (j is Map && j['error'] is String) message = j['error'] as String;
    } catch (_) {}
    throw ApiException(message);
  }

  Future<bool> ping() => _guard(() async {
        final r = await _client.get(_uri('/m/health'), headers: _headers).timeout(AppConfig.requestTimeout);
        return r.statusCode == 200;
      });

  Future<ReportSummary> createReport(List<XFile> photos, String title) => _guard(() async {
        final req = http.MultipartRequest('POST', _uri('/m/reports'));
        req.headers.addAll(_headers);
        if (title.trim().isNotEmpty) req.fields['title'] = title.trim();
        for (final p in photos) {
          req.files.add(await http.MultipartFile.fromPath('photos', p.path, contentType: _mediaType(p.path)));
        }
        final streamed = await _client.send(req).timeout(AppConfig.uploadTimeout);
        final res = await http.Response.fromStream(streamed).timeout(AppConfig.uploadTimeout);
        return ReportSummary.fromJson((_decode(res) as Map).cast<String, dynamic>());
      });

  Future<List<HistoryItem>> history() => _guard(() async {
        final r = await _client.get(_uri('/m/reports'), headers: _headers).timeout(AppConfig.requestTimeout);
        return (_decode(r) as List).map((e) => HistoryItem.fromJson((e as Map).cast<String, dynamic>())).toList();
      });

  Future<ReportSummary> report(String id) => _guard(() async {
        final r = await _client.get(_uri('/m/reports/$id'), headers: _headers).timeout(AppConfig.requestTimeout);
        return ReportSummary.fromJson((_decode(r) as Map).cast<String, dynamic>());
      });

  Future<void> delete(String id) => _guard(() async {
        final r = await _client.delete(_uri('/m/reports/$id'), headers: _headers).timeout(AppConfig.requestTimeout);
        _decode(r);
      });

  Uri _x(String path, [Map<String, String>? query]) => _uri('/m/x$path', query);

  Future<dynamic> _send(String method, String path, [Object? body]) => _guard(() async {
        final headers = <String, String>{..._headers, 'content-type': 'application/json'};
        final uri = _x(path);
        final data = jsonEncode(body ?? <String, dynamic>{});
        late http.Response r;
        switch (method) {
          case 'POST':
            r = await _client.post(uri, headers: headers, body: data).timeout(AppConfig.uploadTimeout);
          case 'PUT':
            r = await _client.put(uri, headers: headers, body: data).timeout(AppConfig.requestTimeout);
          case 'DELETE':
            r = await _client.delete(uri, headers: _headers).timeout(AppConfig.requestTimeout);
          default:
            r = await _client.get(uri, headers: _headers).timeout(AppConfig.requestTimeout);
        }
        return _decode(r);
      });

  Uri imageUri(String sampleId) => _x('/samples/$sampleId/image');

  Uri standardizedUri(String sampleId, int version, {int ppm = 20}) => _x('/samples/$sampleId/standardized.png', {'ppm': '$ppm', 'v': '$version'});

  Future<String> createSession(String title) async {
    final j = await _send('POST', '/sessions', {'title': title}) as Map;
    return j['id'].toString();
  }

  Future<Map<String, dynamic>> uploadPhoto(String sessionId, int slot, XFile file) => _guard(() async {
        final req = http.MultipartRequest('POST', _uri('/m/upload/$sessionId'));
        req.headers.addAll(_headers);
        req.fields['slot'] = '$slot';
        req.fields['name'] = 'Образец $slot';
        req.files.add(await http.MultipartFile.fromPath('file', file.path, contentType: _mediaType(file.path)));
        final streamed = await _client.send(req).timeout(AppConfig.uploadTimeout);
        final res = await http.Response.fromStream(streamed).timeout(AppConfig.uploadTimeout);
        return (_decode(res) as Map).cast<String, dynamic>();
      });

  Future<void> deleteSample(String sampleId) async {
    await _send('DELETE', '/samples/$sampleId');
  }

  Future<Analysis> analyze(String sampleId, double sideMm) async {
    final j = await _send('POST', '/samples/$sampleId/calibrate', {'side_mm': sideMm, 'save': false}) as Map;
    return Analysis.fromJson(j.cast<String, dynamic>());
  }

  Future<Map<String, dynamic>> setCalibration(String sampleId, List<Offset> corners, double sideMm, {required bool manual, String? kind}) async {
    final body = <String, Object?>{'corners': pointsJson(corners), 'side_mm': sideMm, 'method': manual ? 'manual' : 'auto'};
    if (kind != null) body['kind'] = kind;
    final j = await _send('PUT', '/samples/$sampleId/calibration', body) as Map;
    return j.cast<String, dynamic>();
  }

  Future<List<Measure>> measures(String sampleId) async {
    final j = await _send('GET', '/samples/$sampleId') as Map;
    return ((j['measurements'] ?? []) as List).map((e) => Measure.fromJson((e as Map).cast<String, dynamic>())).toList();
  }

  Future<List<Offset>> autoOutline(String sampleId) async {
    final j = await _send('POST', '/samples/$sampleId/segment', {'channel': 'g', 'apply': false, 'min_area_mm2': 0.5}) as Map;
    final regions = (j['regions'] ?? []) as List;
    if (regions.isEmpty) return <Offset>[];
    Map<dynamic, dynamic> best = regions.first as Map;
    for (final r in regions) {
      final m = r as Map;
      if (((m['area_mm2'] ?? 0) as num) > ((best['area_mm2'] ?? 0) as num)) best = m;
    }
    return parsePoints(best['vertices']);
  }

  Future<Measure> addPolygon(String sampleId, List<Offset> vertices) async {
    final j = await _send('POST', '/samples/$sampleId/measurements', {'kind': 'polygon', 'vertices': pointsJson(vertices)}) as Map;
    return Measure.fromJson(j.cast<String, dynamic>());
  }

  Future<void> deleteMeasure(String id) async {
    await _send('DELETE', '/measurements/$id');
  }

  Future<Map<String, dynamic>?> compare(String sessionId) async {
    try {
      final j = await _send('GET', '/sessions/$sessionId/compare') as Map;
      return j.cast<String, dynamic>();
    } on ApiException {
      return null;
    }
  }

  Future<void> saveReport(String sessionId, String title) async {
    await _send('POST', '/sessions/$sessionId/report', {'title': title, 'operator': 'Мобильное приложение'});
  }

  MediaType _mediaType(String path) {
    final p = path.toLowerCase();
    if (p.endsWith('.png')) return MediaType('image', 'png');
    if (p.endsWith('.webp')) return MediaType('image', 'webp');
    if (p.endsWith('.tif') || p.endsWith('.tiff')) return MediaType('image', 'tiff');
    return MediaType('image', 'jpeg');
  }
}
