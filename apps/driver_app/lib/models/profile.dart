class Profile {
  final String id;
  final String role; // 'manager' | 'driver'
  final String? employeeCode;
  final String fullName;
  final String? phone;
  final String? distributionCenterId;
  final String? serviceAreaId;

  const Profile({
    required this.id,
    required this.role,
    required this.fullName,
    this.employeeCode,
    this.phone,
    this.distributionCenterId,
    this.serviceAreaId,
  });

  factory Profile.fromMap(Map<String, dynamic> m) => Profile(
        id: m['id'] as String,
        role: m['role'] as String,
        fullName: (m['full_name'] ?? '') as String,
        employeeCode: m['employee_code'] as String?,
        phone: m['phone'] as String?,
        distributionCenterId: m['distribution_center_id'] as String?,
        serviceAreaId: m['service_area_id'] as String?,
      );

  bool get isDriver => role == 'driver';
}
