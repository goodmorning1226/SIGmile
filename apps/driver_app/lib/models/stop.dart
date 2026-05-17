class Stop {
  final String id;
  final String? externalCode;
  final String name;
  final String stopType;
  final String address;
  final double? lat;
  final double? lng;
  final String? timeWindowStart; // 'HH:MM:SS'
  final String? timeWindowEnd;
  final int defaultServiceMinutes;
  final String? contactName;
  final String? contactPhone;
  final String? notes;

  const Stop({
    required this.id,
    required this.name,
    required this.stopType,
    required this.address,
    required this.defaultServiceMinutes,
    this.externalCode,
    this.lat,
    this.lng,
    this.timeWindowStart,
    this.timeWindowEnd,
    this.contactName,
    this.contactPhone,
    this.notes,
  });

  factory Stop.fromMap(Map<String, dynamic> m) => Stop(
        id: m['id'] as String,
        name: (m['name'] ?? '') as String,
        stopType: (m['stop_type'] ?? 'convenience_store') as String,
        address: (m['address'] ?? '') as String,
        defaultServiceMinutes: (m['default_service_minutes'] ?? 10) as int,
        externalCode: m['external_code'] as String?,
        lat: (m['lat'] as num?)?.toDouble(),
        lng: (m['lng'] as num?)?.toDouble(),
        timeWindowStart: m['time_window_start'] as String?,
        timeWindowEnd: m['time_window_end'] as String?,
        contactName: m['contact_name'] as String?,
        contactPhone: m['contact_phone'] as String?,
        notes: m['notes'] as String?,
      );
}
