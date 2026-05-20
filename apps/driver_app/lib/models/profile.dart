class Profile {
  final String id;
  final String role; // 'manager' | 'driver'
  final String? employeeCode;
  final String fullName;
  final String? phone;
  final String? distributionCenterId;
  final String? serviceAreaId;

  // Phase 2 OR-aligned
  final String? shift; // 'day' | 'night'
  final int? maxWorkMinutes;
  final String? vehicleId;
  final String? vehicleType;
  final int? vehicleCapacity;
  final String? temperatureCapability;

  const Profile({
    required this.id,
    required this.role,
    required this.fullName,
    this.employeeCode,
    this.phone,
    this.distributionCenterId,
    this.serviceAreaId,
    this.shift,
    this.maxWorkMinutes,
    this.vehicleId,
    this.vehicleType,
    this.vehicleCapacity,
    this.temperatureCapability,
  });

  factory Profile.fromMap(Map<String, dynamic> m) => Profile(
        id: m['id'] as String,
        role: m['role'] as String,
        fullName: (m['full_name'] ?? '') as String,
        employeeCode: m['employee_code'] as String?,
        phone: m['phone'] as String?,
        distributionCenterId: m['distribution_center_id'] as String?,
        serviceAreaId: m['service_area_id'] as String?,
        shift: m['shift'] as String?,
        maxWorkMinutes: m['max_work_minutes'] as int?,
        vehicleId: m['vehicle_id'] as String?,
        vehicleType: m['vehicle_type'] as String?,
        vehicleCapacity: m['vehicle_capacity'] as int?,
        temperatureCapability: m['temperature_capability'] as String?,
      );

  bool get isDriver => role == 'driver';
}
