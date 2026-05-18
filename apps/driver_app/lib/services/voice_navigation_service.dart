import 'package:flutter/foundation.dart';
import 'package:flutter_tts/flutter_tts.dart';

import 'tomtom_routes_service.dart';

/// 語音導航：在 GPS 跨越距離閾值時念出下一個指令。
///
/// 設計：
///   - 走系統內建 TTS（Android TextToSpeech、iOS AVSpeechSynthesizer、Web SpeechSynthesis）
///   - **完全免費**，不需 API key、不需訂閱
///   - **防重複**：每個 instruction 在每個 threshold 只念一次（用 lastSpoken set 標記）
///   - **threshold-based**：路口前 300m / 100m / 30m 各念一次，模擬 Google 導航
///
/// 用法：
///   1. 初始化一次 [initialize]（設語系、語速）
///   2. 每次 GPS update 呼叫 [maybeSpeak]（自己判斷要不要念）
///   3. 離開導航頁時呼叫 [reset]（清掉已念過的標記 + stop 任何播放中音訊）
class VoiceNavigationService {
  final FlutterTts _tts = FlutterTts();
  bool _initialized = false;
  bool _enabled = true;

  /// 已經念過的「instruction × threshold」組合，避免同一個指令念好幾次。
  /// key 格式：`${routeOffsetMeters.toInt()}@${thresholdBucket}`
  final Set<String> _spokenKeys = {};

  /// 各距離閾值（公尺）— 由遠到近念
  static const _thresholds = [300, 100, 30];

  bool get enabled => _enabled;
  set enabled(bool v) {
    _enabled = v;
    if (!v) stop();
  }

  Future<void> initialize() async {
    if (_initialized) return;
    try {
      // 語系：繁中（zh-TW）；失敗就退簡中
      await _tts.setLanguage('zh-TW').catchError((_) => _tts.setLanguage('zh-CN'));
      await _tts.setSpeechRate(0.55); // Android 默認 1.0 偏快，0.55 接近自然中速
      await _tts.setVolume(1.0);
      await _tts.setPitch(1.0);
      // 共享聲道（不切斷音樂、不被通話打斷）
      try {
        await _tts.setSharedInstance(true);
      } catch (_) {/* Android 沒這個 method，忽略 */}
      _initialized = true;
    } catch (e) {
      debugPrint('[voice] init failed: $e');
    }
  }

  /// 依當前距離 [metersToNext] 決定要不要念 [instruction]。
  ///
  /// 邏輯：找到當前距離小於哪個 threshold（300/100/30），如果該 instruction + threshold
  /// 組合還沒念過 → speak it 並記下；念過 → skip。
  Future<void> maybeSpeak(RouteInstruction instruction, double metersToNext) async {
    if (!_enabled) return;
    if (!_initialized) await initialize();

    int? hitThreshold;
    for (final t in _thresholds) {
      if (metersToNext <= t) {
        hitThreshold = t;
        break;
      }
    }
    if (hitThreshold == null) return;

    final key = '${instruction.routeOffsetMeters.toInt()}@$hitThreshold';
    if (_spokenKeys.contains(key)) return;
    _spokenKeys.add(key);

    // 組合念稿：「兩百公尺後右轉進入松高路」
    final text = _composeSpeech(instruction, hitThreshold);
    try {
      await _tts.stop();
      await _tts.speak(text);
      debugPrint('[voice] 🔊 [$hitThreshold m] $text');
    } catch (e) {
      debugPrint('[voice] speak failed: $e');
    }
  }

  String _composeSpeech(RouteInstruction ins, int threshold) {
    // 30m 已經很近，直接動詞開頭（「右轉進入松高路」）；遠的加距離前綴
    if (threshold == 30) return ins.message;
    return '$threshold 公尺後${ins.message}';
  }

  /// 立刻念一個訊息（不走 threshold 判斷，給 arrival 或 manual 用）。
  Future<void> announce(String text) async {
    if (!_enabled) return;
    if (!_initialized) await initialize();
    try {
      await _tts.stop();
      await _tts.speak(text);
    } catch (e) {
      debugPrint('[voice] announce failed: $e');
    }
  }

  /// 停止當前播放（不清歷史）
  Future<void> stop() async {
    try {
      await _tts.stop();
    } catch (_) {}
  }

  /// 清掉已念過的歷史（換新 route 時呼叫，否則跨 session 不會再念）
  void resetSpokenHistory() => _spokenKeys.clear();

  /// 完整 reset：stop + 清歷史
  Future<void> reset() async {
    await stop();
    resetSpokenHistory();
  }
}
