/**
 * Arabic labels for values that come from data (statuses, payment methods, permissions, API error codes…). The dashboard
 * is Arabic only (L10N-001): every other text is written where it is shown. Lookups are by the value as the API sends
 * it; an unknown value has no label (as before), so callers that can meet one fall back to the value itself.
 */

/** An appointment's next steps. */
export const appointmentActionLabel: Record<string, string> = {
  confirm: 'تأكيد',
  start: 'بدء الزيارة',
  complete: 'إنهاء الزيارة',
  cancel: 'إلغاء الموعد',
  noShow: 'لم يحضر',
  arrive: 'وصل المريض',
};

/** Balance adjustments (waiver, write-off). */
export const adjustmentKindLabel: Record<string, string> = {
  waiver: 'إعفاء قسط',
  write_off: 'إعفاء من المتبقي',
};

/** A patient's history actions. */
export const auditActionLabel: Record<string, string> = {
  patient_merge: 'دمج ملف مكرر',
  patient_merged_into: 'دُمج في ملف آخر',
  patient_view: 'فتح الملف',
  patient_create: 'أنشأ الملف',
  patient_update: 'عدّل البيانات',
  patient_medical_history_update: 'عدّل التاريخ الطبي',
};

/** Service catalogue categories. */
export const catalogCategoryLabel: Record<string, string> = {
  general: 'عام',
  preventive: 'وقائي',
  restorative: 'ترميمي',
  endodontic: 'علاج جذور',
  cosmetic: 'تجميلي',
  orthodontic: 'تقويم',
  surgical: 'جراحي',
  pediatric: 'أطفال',
  prosthodontic: 'تركيبات',
  periodontal: 'لثة',
  surgery: 'جراحة',
  implant: 'زراعة',
};

/** Tooth conditions. */
export const toothConditionLabel: Record<string, string> = {
  healthy: 'سليم',
  caries: 'تسوس',
  filled: 'حشو',
  crown: 'تاج',
  bridge: 'جسر',
  missing: 'مفقود',
  implant: 'زرعة',
  root_canal: 'علاج عصب',
  fractured: 'مكسور',
  extraction_needed: 'يحتاج خلع',
  veneer: 'فينير',
  sealant: 'سد شقوق',
  other: 'أخرى',
};

/** Cash session statuses. */
export const cashStatusLabel: Record<string, string> = {
  open: 'مفتوحة',
  closed: 'مقفلة',
};

/** Weekdays (0 = Sunday). */
export const weekdayLabel: Record<string, string> = {
  '0': 'الأحد',
  '1': 'الاثنين',
  '2': 'الثلاثاء',
  '3': 'الأربعاء',
  '4': 'الخميس',
  '5': 'الجمعة',
  '6': 'السبت',
};

/** Discount approval statuses. */
export const discountStatusLabel: Record<string, string> = {
  none: 'بدون خصم',
  within_limit: 'داخل الحد',
  pending: 'بانتظار الموافقة',
  approved: 'موافق عليه',
  rejected: 'مرفوض',
};

/** API error codes (L10N-003). */
export const errorLabel: Record<string, string> = {
  network: 'تعذّر الاتصال بالخادم. تحقق من الإنترنت وحاول مرة أخرى.',
  invalid_credentials: 'البريد/الموبايل أو كلمة المرور غير صحيحة.',
  login_locked: 'محاولات كثيرة. انتظر قليلًا ثم حاول مرة أخرى.',
  rate_limited: 'طلبات كثيرة. انتظر قليلًا ثم حاول مرة أخرى.',
  account_exists: 'يوجد حساب بهذا البريد أو الموبايل. سجّل الدخول بدلًا من ذلك.',
  slug_taken: 'عنوان الموقع غير متاح، جرّب عنوانًا آخر.',
  invalid_phone: 'رقم الموبايل غير صحيح.',
  otp_invalid: 'الرمز غير صحيح.',
  otp_expired: 'انتهت صلاحية الرمز. اطلب رمزًا جديدًا.',
  otp_locked: 'محاولات خاطئة كثيرة. اطلب رمزًا جديدًا.',
  otp_rate_limited: 'طلبت رموزًا كثيرة. انتظر قليلًا ثم حاول.',
  account_disabled: 'هذا الحساب موقوف.',
  conflict: 'موجود بالفعل.',
  validation_failed: 'راجع البيانات المدخلة.',
  hours_overlap: 'فترتان في نفس اليوم متداخلتان.',
  branch_slug_taken: 'هذا المعرّف مستخدم لفرع آخر.',
  invalid_color: 'اللون يجب أن يكون مثل #1d6fd8.',
  branch_not_found: 'الفرع غير موجود.',
  missing_permission: 'ليست لديك صلاحية لهذا الإجراء.',
  weak_password: 'كلمة المرور ضعيفة: 8 أحرف على الأقل وتحتوي على حروف وأرقام.',
  invitation_pending: 'توجد دعوة مفتوحة لهذا البريد. أعد إرسالها من قائمة الدعوات.',
  already_member: 'هذا الشخص عضو في العيادة بالفعل.',
  doctor_already_linked: 'لهذا الطبيب حساب دخول بالفعل.',
  last_owner: 'يجب أن يبقى للعيادة مالك نشط واحد على الأقل.',
  invitation_invalid: 'رابط الدعوة لم يعد صالحًا. اطلب من العيادة دعوة جديدة.',
  invitation_not_found: 'الدعوة غير موجودة أو قُبلت بالفعل.',
  member_not_found: 'العضو غير موجود.',
  role_not_found: 'الدور غير موجود.',
  full_name_required: 'أدخل اسمك.',
  access_revoked: 'انتهت صلاحية دخولك لهذه العيادة.',
  access_changed: 'تغيّرت صلاحياتك. أعد تحميل الصفحة.',
  rule_violation: 'لا يمكن الحفظ: تعارض مع قواعد النظام (مثلًا يجب أن يبقى اسم واحد على الأقل).',
  plan_limit_reached: 'وصلت إلى الحد المسموح في باقتك. رقِّ الباقة لإضافة المزيد.',
  site_not_found: 'لا يوجد موقع لهذه العيادة بعد.',
  schedule_overlap: 'فترتان متداخلتان في نفس اليوم.',
  branch_not_assigned: 'الطبيب غير مُضاف إلى هذا الفرع.',
  doctor_not_found: 'الطبيب غير موجود.',
  catalog_code_unknown: 'هذه الخدمة غير موجودة في القائمة.',
  service_already_added: 'هذه الخدمة مضافة بالفعل إلى قائمتك.',
  service_not_found: 'الخدمة غير موجودة.',
  code_invalid: 'الرمز غير صالح لهذا الفرع اليوم (خطأ، مستخدم، منتهٍ أو ملغي).',
  invalid_transition: 'لا يمكن تطبيق هذا الإجراء على حالة الموعد الحالية.',
  appointment_not_found: 'الموعد غير موجود.',
  outside_schedule: 'الطبيب غير مجدول في هذا الوقت.',
  slot_taken: 'هذا الوقت محجوز بالفعل.',
  unsupported_file_type: 'ارفع ملف PDF أو صورة (JPEG أو PNG أو WebP).',
  consent_draft: 'هذا النموذج مسودة: يراجعه مالك العيادة ويحفظه قبل التوقيع.',
  consent_archived: 'هذا النموذج مؤرشف.',
  consent_outdated: 'صدر إصدار أحدث من هذا النموذج؛ حدّث الصفحة.',
  consent_not_found: 'النموذج غير موجود.',
  consent_text_locked: 'لا يُعدَّل إصدار محفوظ؛ احفظ إصدارًا جديدًا.',
  consent_text_conflict: 'حفظ شخص آخر النموذج في اللحظة نفسها؛ حاول مرة أخرى.',
  consent_locked: 'الموافقة الموقّعة لا تُعدَّل؛ يمكن سحبها مرة واحدة.',
  consent_record_not_found: 'الموافقة غير موجودة.',
  consent_revoked: 'سُحبت هذه الموافقة من قبل.',
  visit_not_this_patient: 'هذه الزيارة لمريض آخر.',
  signature_required: 'وقّع داخل المربع أولًا.',
  file_too_large: 'الملف أكبر من المسموح.',
  owner_only: 'هذا الإجراء لمالك العيادة فقط.',
  export_in_progress: 'هناك نسخة من البيانات قيد التجهيز بالفعل.',
  export_limit: 'وصلت إلى الحد اليومي لنسخ البيانات (3 في اليوم). حاول غدًا.',
  export_not_ready: 'هذه النسخة غير جاهزة أو انتهت مدتها.',
  confirm_name_mismatch: 'اسم العيادة غير مطابق.',
  clinic_deleted: 'هذه العيادة محذوفة. لاستعادتها خلال 90 يومًا من الحذف تواصل مع إدارة المنصة.',
  lead_not_found: 'هذا الطلب غير موجود.',
  legal_acceptance_required: 'وافق على شروط الاستخدام وسياسة الخصوصية (واتفاقية معالجة البيانات لصاحب العيادة) للمتابعة.',
  legal_document_not_found: 'المستند غير منشور بعد.',
  clinic_suspended: 'هذه العيادة موقوفة (قد تكون انتهت الفترة التجريبية). تواصل مع إدارة المنصة لتفعيل الاشتراك.',
  platform_session_required: 'سجّل الدخول إلى لوحة إدارة المنصة.',
  trial_out_of_range: 'نهاية التجربة تكون بعد اليوم وخلال سنة.',
  not_trialing: 'العيادة ليست في فترة تجريبية.',
  clinic_status: 'حالة العيادة لا تسمح بهذا الإجراء.',
  subscription_plan_not_found: 'الخطة غير موجودة.',
  reason_required: 'اكتب السبب (3 أحرف على الأقل).',
  trial_ended: 'انتهت الفترة التجريبية: مدّد التجربة أو فعّل الاشتراك أولًا.',
  already_active: 'الاشتراك مفعّل بالفعل.',
  owner_role_fixed: 'دور المالك ثابت: يملك كل الصلاحيات دائمًا.',
  role_archived: 'هذا الدور مؤرشف ولا يُعطى لأحد.',
  role_in_use: 'أعضاء أو دعوات مفتوحة ما زالت تحمل هذا الدور؛ غيّر أدوارهم أولًا.',
  role_name_taken: 'يوجد دور بهذا الاسم.',
  permission_unknown: 'هذه الصلاحية لا تُعطى لدور.',
  permission_requires: 'هذه الصلاحية تحتاج صلاحية أخرى معها.',
  permission_not_held: 'تستطيع إعطاء الصلاحيات التي تملكها فقط.',
  own_role: 'لا يمكنك تغيير دورك أو صلاحياتك بنفسك.',
  owner_role_only: 'دور المالك يعطيه أو يسحبه المالك فقط.',
  visit_finalized: 'الزيارة معتمدة؛ أضف تعديلًا بدل التغيير.',
  not_your_visit: 'هذه زيارة طبيب آخر.',
  not_your_appointment: 'هذا موعد طبيب آخر.',
  appointment_not_in_progress: 'سجّل وصول المريض أولًا.',
  price_out_of_range: 'السعر خارج نطاق سعر الخدمة؛ أي تخفيض يكون خصمًا على الفاتورة.',
  price_required: 'أدخل السعر؛ هذه الخدمة بسعر حسب الكشف.',
  plan_locked: 'بنود الخطة المعتمدة ثابتة.',
  plan_empty: 'أضف بندًا واحدًا على الأقل.',
  plan_not_accepted: 'سجّل موافقة المريض على الخطة أولًا.',
  plan_item_closed: 'هذا البند تم أو أُلغي.',
  procedure_billed: 'الإجراء على فاتورة.',
  prescription_already_corrected: 'هذه الروشتة صُححت من قبل.',
  recall_closed: 'هذه المتابعة مغلقة.',
  appointment_not_open: 'الموعد لم يعد مفتوحًا.',
  amendment_reason_required: 'اكتب سبب التعديل.',
  merge_self: 'اختر ملفًا آخر للدمج.',
  already_merged: 'أحد الملفين مدموج بالفعل.',
  invoice_locked: 'الفاتورة صادرة ولا تُعدَّل.',
  invoice_empty: 'أضف بندًا واحدًا على الأقل.',
  amount_exceeds_balance: 'المبلغ أكبر من المتبقي.',
  reference_required: 'أدخل مرجع التحويل أو المحفظة أو إنستاباي.',
  payment_not_reversible: 'لا يمكن إلغاء دفعة عليها استرداد.',
  refund_exceeds_payment: 'الاسترداد أكبر من الدفعة.',
  payment_not_refundable: 'لا يمكن استرداد هذه الدفعة.',
  invoice_has_payments: 'استرد المدفوعات أو ألغِها قبل إلغاء الفاتورة.',
  invoice_not_payable: 'الفاتورة غير مستحقة الدفع.',
  reversal_not_allowed: 'يلغي الدفعة من استلمها في نفس اليوم، أو المالك.',
  currency_locked: 'العملة ثابتة بعد إصدار أول فاتورة.',
  procedure_not_billable: 'الإجراء لمريض آخر أو مفوتر بالفعل.',
  discount_pending_approval: 'الخصم بانتظار الموافقة أو مرفوض.',
  self_approval: 'لا يوافق أحد على طلبه.',
  discount_exceeds_subtotal: 'الخصم أكبر من المبلغ.',
  discount_reason_required: 'اكتب سبب الخصم.',
  plan_exists: 'للفاتورة تقسيط بالفعل.',
  installments_total_mismatch: 'مجموع الأقساط لا يساوي المتبقي.',
  installments_dates: 'رتّب تواريخ الأقساط تصاعديًا.',
  amount_exceeds_installment: 'المبلغ أكبر من المتبقي من القسط.',
  installment_closed: 'هذا القسط مدفوع أو معفى.',
  today_only: 'يمكنك رؤية أرقام اليوم فقط.',
  invalid_period: 'يجب أن تنتهي الفترة بعد بدايتها.',
  period_too_long: 'التقرير يغطي سنة على الأكثر.',
  not_a_doctor: 'حسابك غير مرتبط بطبيب.',
  generic_400: 'تعذّر تنفيذ الطلب. راجع البيانات وحاول مرة أخرى.',
  generic_401: 'انتهت جلستك. سجّل الدخول مرة أخرى.',
  generic_403: 'ليست لديك صلاحية لهذا الإجراء.',
  generic_404: 'العنصر غير موجود أو لم يعد متاحًا.',
  generic_409: 'تغيّرت البيانات أثناء ذلك. حدّث الصفحة وحاول مرة أخرى.',
  generic_429: 'محاولات كثيرة. انتظر قليلًا ثم حاول مرة أخرى.',
  generic_500: 'حدث خطأ غير متوقع. حاول مرة أخرى بعد قليل.',
  unhealthy: 'الخدمة غير متاحة الآن. حاول بعد قليل.',
  internal: 'حدث خطأ غير متوقع. حاول مرة أخرى بعد قليل.',
  not_found: 'العنصر غير موجود أو لم يعد متاحًا.',
  forbidden: 'ليست لديك صلاحية لهذا الإجراء.',
  busy: 'مستخدم آخر يعدّل هذا الآن. حاول مرة أخرى بعد لحظات.',
  invalid_reference: 'يشير الطلب إلى عنصر غير موجود.',
  missing_field: 'بيانات مطلوبة ناقصة.',
  no_clinic: 'لم يتم اختيار عيادة. سجّل الدخول مرة أخرى.',
  clinic_not_found: 'العيادة غير موجودة.',
  user_not_found: 'المستخدم غير موجود.',
  otp_used: 'هذا الرمز استُخدم من قبل. اطلب رمزًا جديدًا.',
  session_expired: 'انتهت جلستك. سجّل الدخول مرة أخرى.',
  no_session: 'سجّل الدخول للمتابعة.',
  refresh_race: 'تم تحديث الجلسة في نافذة أخرى. أعد المحاولة.',
  session_revoked: 'أُنهيت جلستك. سجّل الدخول مرة أخرى.',
  main_branch_inactive: 'لا يمكن إيقاف الفرع الرئيسي. اجعل فرعًا آخر رئيسيًا أولًا.',
  service_not_bookable: 'هذه الخدمة غير متاحة للحجز.',
  date_out_of_range: 'التاريخ خارج الفترة المتاحة للحجز.',
  slot_unavailable: 'هذا الموعد لم يعد متاحًا. اختر وقتًا آخر.',
  patient_merged: 'هذا الملف دُمج في ملف آخر. افتح الملف الأساسي.',
  not_your_patient: 'هذا المريض ليس من مرضاك.',
  doctor_required: 'اختر الطبيب.',
  visit_not_found: 'الزيارة غير موجودة.',
  visit_not_final: 'الزيارة ما زالت مسودة؛ عدّل الملاحظات مباشرة.',
  visit_kept: 'الزيارات الطبية لا تُحذف.',
  visit_mismatch: 'الزيارة تخص مريضًا آخر.',
  plan_not_found: 'خطة العلاج غير موجودة.',
  plan_closed: 'خطة العلاج مغلقة.',
  plan_item_not_found: 'بند الخطة غير موجود.',
  plan_item_mismatch: 'بند الخطة يخص مريضًا أو خطة أخرى.',
  invalid_item_status: 'لا يمكن نقل بند الخطة إلى هذه الحالة.',
  invalid_tooth: 'استخدم رقم سن صحيحًا بنظام FDI (11–48 أو 51–85).',
  discount_too_large: 'الخصم أكبر من قيمة البند.',
  procedure_not_found: 'الإجراء غير موجود.',
  procedure_fixed: 'لا يُعدّل هذا الإجراء؛ سجّل إجراءً آخر.',
  prescription_not_found: 'الروشتة غير موجودة.',
  prescription_mismatch: 'الروشتة لا تطابق زيارتها.',
  prescription_issued: 'الروشتة الصادرة لا تُعدّل؛ أصدر تصحيحًا.',
  appointment_mismatch: 'الموعد يخص مريضًا آخر.',
  recall_not_found: 'المتابعة غير موجودة.',
  invoice_not_found: 'الفاتورة غير موجودة.',
  line_not_found: 'بند الفاتورة غير موجود.',
  invoice_draft: 'الفاتورة ما زالت مسودة؛ أصدرها أولًا.',
  invoice_void: 'الفاتورة ملغاة.',
  idempotency_key_reused: 'سُجّلت هذه العملية من قبل. حدّث الصفحة.',
  installment_invoice_mismatch: 'القسط يخص فاتورة أخرى.',
  installment_not_found: 'القسط غير موجود.',
  payment_not_found: 'الدفعة غير موجودة.',
  discount_not_pending: 'هذا الخصم لا ينتظر الموافقة.',
  currency_mismatch: 'يجب أن تكون الفاتورة بعملة العيادة.',
  session_not_found: 'خزنة اليوم غير موجودة.',
  expense_not_found: 'المصروف غير موجود.',
  category_inactive: 'هذا البند لم يعد مستخدمًا.',
  category_not_found: 'البند غير موجود.',
  category_name_taken: 'يوجد بند بهذا الاسم.',
  date_in_future: 'لا يُسجل بتاريخ في المستقبل.',
  expense_locked: 'المصروف المسجل لا يُعدّل؛ ألغه وسجله من جديد.',
  expense_not_pending: 'هذا المصروف لا ينتظر الموافقة.',
  expense_void: 'هذا المصروف ملغى بالفعل.',
  expense_has_document: 'لهذا المصروف مستند بالفعل؛ المستند لا يُستبدل.',
  void_reason_required: 'اكتب سبب الإلغاء.',
  session_closed: 'خزنة هذا اليوم مقفلة. يمكن لصاحب العيادة إعادة فتحها.',
  session_already_open: 'خزنة اليوم مفتوحة بالفعل.',
  session_open: 'هذه الخزنة مفتوحة.',
  previous_session_open: 'خزنة يوم سابق ما زالت مفتوحة؛ أقفلها أولًا.',
  another_session_open: 'خزنة أخرى لهذا الفرع مفتوحة؛ أقفلها أولًا.',
  difference_note_required: 'اشرح سبب الفرق بين النقدية الفعلية والمتوقعة.',
  room_taken: 'هذا الكرسي محجوز في هذا الوقت.',
  room_not_in_branch: 'الكرسي غير موجود في هذا الفرع أو غير متاح.',
  room_name_taken: 'يوجد كرسي بهذا الاسم في الفرع.',
  nothing_to_change: 'لم يتغير شيء.',
  holiday_exists: 'هذا اليوم إجازة بالفعل لهذا الفرع.',
  invalid_range: 'يجب أن يكون الانتهاء بعد البداية.',
  time_off_too_long: 'لا يمكن أن تزيد الإجازة عن سنة.',
  invalid_reminders: 'حتى 4 تذكيرات، بين 15 دقيقة و7 أيام قبل الموعد.',
  holiday_not_found: 'الإجازة غير موجودة.',
  time_off_not_found: 'الإجازة غير موجودة.',
  room_not_found: 'الكرسي غير موجود.',
  branch_forbidden: 'ليست لديك صلاحية العمل في هذا الفرع.',
  doctor_not_at_branch: 'هذا الطبيب لا يعمل في هذا الفرع.',
  doctor_inactive: 'هذا الطبيب موقوف ولا يمكن الحجز له.',
  email_not_verified: 'أكّد بريدك الإلكتروني أولًا. أرسلنا لك رمزًا جديدًا.',
  hold_expired: 'انتهت مهلة الحجز المؤقت.',
  note_required: 'اكتب سبب تسجيل الوصول بدون رمز.',
  booking_refused: 'الحجز غير متاح لهذا المريض.',
  patient_not_found: 'المريض غير موجود.',
  patient_blocked: 'هذا المريض ممنوع من الحجز.',
  guardian_is_self: 'لا يمكن أن يكون المريض ولي أمر نفسه.',
  guardian_not_found: 'ولي الأمر المحدد غير موجود.',
  subscription_inactive: 'اشتراك العيادة غير نشط.',
  invalid_image: 'الملف ليس صورة صالحة.',
  unsupported_image_type: 'يُقبل JPG وPNG وWebP فقط.',
  image_too_small: 'الصورة صغيرة جدًا (200 بكسل على الأقل لكل ضلع).',
  payload_too_large: 'الملف أكبر من 10 ميجابايت.',
  storage_limit_reached: 'امتلأت مساحة الصور في باقتك. احذف صورًا أو رقِّ الباقة.',
  file_required: 'اختر صورة للرفع.',
  file_not_found: 'الصورة غير موجودة؛ ارفعها مرة أخرى.',
  link_expired: 'انتهت صلاحية رابط الصورة؛ حدّث الصفحة.',
  alt_required: 'أضف وصفًا للصورة (أو تعليقًا) قبل نشرها.',
  featured_requires_published: 'الصورة المميزة يجب أن تكون منشورة.',
  order_mismatch: 'تغيّرت الصور أثناء الترتيب؛ حدّث الصفحة وحاول مرة أخرى.',
  gallery_item_not_found: 'الصورة غير موجودة.',
  logo_too_small: 'الشعار صغير جدًا (48 بكسل على الأقل لكل ضلع).',
  wrong_image_kind: 'هذه الصورة رُفعت لغرض آخر؛ ارفعها مرة أخرى هنا.',
};

/** Expense statuses. */
export const expenseStatusLabel: Record<string, string> = {
  pending: 'بانتظار الموافقة',
  approved: 'معتمد',
  rejected: 'مرفوض',
  void: 'ملغى',
};

/** Data export statuses. */
export const exportStatusLabel: Record<string, string> = {
  queued: 'في الانتظار',
  running: 'جارٍ التجهيز',
  ready: 'جاهزة',
  failed: 'تعذّر التجهيز',
  expired: 'انتهت مدتها',
};

/** A patient's fields (merge, history). */
export const patientFieldLabel: Record<string, string> = {
  file_no: 'رقم الملف',
  occupation: 'المهنة',
  guardian_name: 'اسم ولي الأمر',
  guardian_phone: 'رقم ولي الأمر',
  guardian_relation: 'صلة القرابة',
  full_name: 'الاسم',
  phone: 'الموبايل',
  phone_alt: 'موبايل آخر',
  email: 'البريد',
  gender: 'النوع',
  date_of_birth: 'تاريخ الميلاد',
  city: 'المدينة',
  address: 'العنوان',
  notes: 'الملاحظات',
  tags: 'الوسوم',
  marketing_opt_in: 'الموافقة التسويقية',
  reviewed: 'المراجعة',
  allergies: 'الحساسية',
  conditions: 'الأمراض',
  medications: 'الأدوية',
  is_pregnant: 'الحمل',
  is_smoker: 'التدخين',
};

/** Follow-up list tabs. */
export const followUpViewLabel: Record<string, string> = {
  due: 'مستحقة الآن',
  upcoming: 'قادمة',
  closed: 'مغلقة',
};

/** Follow-up statuses. */
export const followUpStatusLabel: Record<string, string> = {
  pending: 'لم يُتصل به',
  contacted: 'تم الاتصال',
  booked: 'حُجز موعد',
  done: 'تمت',
  dismissed: 'مُلغاة',
};

/** Follow-up in N months. */
export const inMonthsLabel: Record<string, string> = {
  '1': 'بعد شهر',
  '3': 'بعد 3 شهور',
  '6': 'بعد 6 شهور',
  '12': 'بعد سنة',
};

/** Invoice statuses. */
export const invoiceStatusLabel: Record<string, string> = {
  draft: 'مسودة',
  issued: 'صادرة',
  partially_paid: 'مسددة جزئيًا',
  paid: 'مسددة',
  void: 'ملغاة',
};

/** Invoice list tabs. */
export const invoiceFilterLabel: Record<string, string> = {
  open: 'غير مسددة',
  draft: 'مسودات',
  paid: 'مسددة',
  void: 'ملغاة',
  all: 'الكل',
  overdue: 'أقساط متأخرة',
};

/** Installment statuses. */
export const installmentStatusLabel: Record<string, string> = {
  due: 'مستحق',
  partially_paid: 'مدفوع جزئيًا',
  paid: 'مدفوع',
  waived: 'معفى',
};

/** Treatment-plan item statuses. */
export const planItemStatusLabel: Record<string, string> = {
  planned: 'مخطط',
  scheduled: 'محجوز',
  done: 'تم',
  cancelled: 'ملغى',
};

/** A patient file's kind. */
export const fileKindLabel: Record<string, string> = {
  xray: 'أشعة',
  clinical_photo: 'صورة سريرية',
  document: 'مستند',
};

/** What a patient merge moves. */
export const mergeMovesLabel: Record<string, string> = {
  appointments: 'مواعيد',
  invoices: 'فواتير',
  payment_plans: 'خطط تقسيط',
  payments: 'مدفوعات',
  visits: 'زيارات',
  treatment_plans: 'خطط علاج',
  prescriptions: 'روشتات',
  tooth_records: 'تسجيلات خريطة الأسنان',
  recalls: 'متابعات',
  patient_files: 'أشعة وملفات',
  patient_consents: 'إقرارات',
  lab_orders: 'طلبات معمل',
  reviews: 'تقييمات',
  waitlist_entries: 'قائمة الانتظار',
  notifications: 'إشعارات',
  patient_medical_history_versions: 'نسخ التاريخ الطبي',
};

/** Empty follow-up tabs. */
export const noFollowUpsText: Record<string, string> = {
  due: 'لا أحد مستحق للمتابعة اليوم.',
  upcoming: 'لا متابعات قادمة.',
  closed: 'لا متابعات مغلقة بعد.',
};

/** Permission groups. */
export const permissionGroupLabel: Record<string, string> = {
  clinic: 'العيادة والإعدادات',
  patients: 'المرضى',
  clinical: 'السجل العلاجي',
  appointments: 'المواعيد',
  billing: 'الفواتير والمدفوعات',
  finance: 'المصروفات والخزنة',
  reports: 'التقارير والسجل',
};

/** Permissions. */
export const permissionLabel: Record<string, string> = {
  'branches:read': 'عرض الفروع وساعات العمل',
  'branches:write': 'إضافة الفروع وتعديلها وساعات عملها',
  'settings:write': 'إعدادات العيادة: الملف والأطباء والخدمات وقواعد الحجز والعطلات والغرف',
  'website:write': 'محتوى الموقع والمعرض',
  'staff:manage': 'إدارة فريق العمل والأدوار (دعوة وتغيير أدوار وتعطيل)',
  'patients:read': 'عرض المرضى',
  'patients:write': 'إضافة المرضى وتعديل بياناتهم',
  'patients:merge': 'دمج الملفات المكررة',
  'patients:block': 'منع مريض من الحجز عبر الموقع',
  'clinical:read': 'عرض السجل الطبي والزيارات والمخطط والملفات',
  'clinical:write': 'كتابة الزيارات والسجل الطبي',
  'treatments:write:own': 'خطط العلاج والإجراءات لمرضى الطبيب نفسه',
  'appointments:read': 'عرض المواعيد',
  'appointments:write': 'حجز المواعيد ونقلها وتسجيل الحضور',
  'appointments:write:own': 'إدارة مواعيد الطبيب نفسه فقط',
  'appointments:override': 'الحجز خارج ساعات العمل أو قواعد الحجز',
  'invoices:read': 'عرض كل الفواتير',
  'invoices:read:own': 'عرض فواتير مرضى الطبيب نفسه',
  'invoices:write': 'إنشاء الفواتير وإصدارها',
  'invoices:void': 'إلغاء فاتورة',
  'payments:write': 'تسجيل المدفوعات وخطط الأقساط',
  'payments:refund': 'رد مبلغ لمريض',
  'payments:reverse': 'عكس دفعة سُجلت خطأً',
  'payments:adjust': 'الإعفاء والشطب من رصيد المريض',
  'discounts:apply': 'تطبيق خصم في حدود الدور',
  'discounts:approve': 'اعتماد الخصومات فوق الحد',
  'expenses:read': 'عرض المصروفات',
  'expenses:write': 'تسجيل المصروفات وإلغاؤها',
  'expenses:approve': 'اعتماد المصروفات وإدارة تصنيفاتها',
  'cash:operate': 'فتح الخزنة اليومية وإغلاقها',
  'cash:reopen': 'إعادة فتح يوم خزنة مغلق',
  'reports:read': 'كل التقارير',
  'reports:read:daily': 'تقرير إيرادات اليوم فقط',
  'reports:read:own': 'تقارير الطبيب نفسه',
  'audit:read': 'سجل التغييرات',
};

/** Platform audit actions. */
export const platformActionLabel: Record<string, string> = {
  tenant_deletion_requested: 'طلب المالك حذف العيادة',
  tenant_restored: 'استعادة العيادة',
  tenant_purged: 'محو بيانات العيادة نهائيًا',
  tenant_purge_blocked: 'تعذّر المحو: للعيادة فواتير من المنصة',
  lead_status: 'تغيير حالة طلب تواصل',
  legal_published: 'نشر إصدار مستند قانوني',
  tenant_suspended: 'إيقاف العيادة',
  tenant_reactivated: 'إعادة التفعيل',
  tenant_trial_extended: 'تمديد التجربة',
  tenant_plan_changed: 'تغيير الخطة',
  tenant_note_added: 'إضافة ملاحظة',
  plan_updated: 'تعديل خطة',
  platform_sign_in: 'دخول اللوحة',
  tenant_trial_expired: 'إيقاف تلقائي: انتهت التجربة',
  tenant_activated: 'تفعيل الاشتراك',
};

/** Billing cycles. */
export const billingCycleLabel: Record<string, string> = {
  monthly: 'شهري',
  yearly: 'سنوي',
};

/** Plan features. */
export const planFeatureLabel: Record<string, string> = {
  custom_domain: 'نطاق خاص للموقع',
  online_payments: 'الدفع الإلكتروني',
  remove_badge: 'إخفاء شارة المنصة من الموقع',
};

/** Landing-page lead statuses. */
export const leadStatusLabel: Record<string, string> = {
  new: 'جديد',
  contacted: 'تم التواصل',
  converted: 'اشتركت',
  lost: 'لم تكمل',
};

/** Legal documents (platform panel). */
export const legalDocLabel: Record<string, string> = {
  terms: 'شروط الاستخدام',
  privacy: 'سياسة الخصوصية',
  dpa: 'اتفاقية معالجة البيانات',
};

/** Plan limits. */
export const planLimitLabel: Record<string, string> = {
  branches: 'الفروع',
  staff: 'أعضاء الفريق',
  doctors: 'الأطباء',
  patients: 'المرضى',
  storage_mb: 'مساحة الملفات (ميجابايت)',
};

/** A clinic's status (platform panel). */
export const clinicStatusLabel: Record<string, string> = {
  onboarding: 'قيد الإعداد',
  trialing: 'فترة تجريبية',
  active: 'نشطة',
  past_due: 'متأخرة السداد',
  suspended: 'موقوفة',
  cancelled: 'ملغاة',
};

/** What moving a plan means. */
export const planMoveText: Record<string, string> = {
  proposed: 'تُعرض الخطة على المريض. يمكن تعديل البنود حتى يوافق.',
  accepted: 'يُسجَّل أن المريض وافق الآن، باسمك. بعدها تثبت البنود والأسعار التقديرية.',
  cancelled: 'تُلغى الخطة وتبقى محفوظة في ملف المريض.',
};

/** Moving a plan to a status (button). */
export const planMoveLabel: Record<string, string> = {
  proposed: 'اقتراح على المريض',
  accepted: 'تسجيل موافقة المريض',
  cancelled: 'إلغاء الخطة',
};

/** Treatment-plan statuses. */
export const planStatusLabel: Record<string, string> = {
  draft: 'مسودة',
  proposed: 'مقترحة',
  accepted: 'وافق المريض',
  in_progress: 'قيد التنفيذ',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
  active: 'جارٍ',
  defaulted: 'متعثر',
};

/** Payment methods. */
export const paymentMethodLabel: Record<string, string> = {
  cash: 'نقدي',
  card: 'بطاقة',
  bank_transfer: 'تحويل بنكي',
  wallet: 'محفظة إلكترونية',
  instapay: 'إنستاباي',
};

/** Quick periods. */
export const periodPresetLabel: Record<string, string> = {
  today: 'اليوم',
  thisMonth: 'هذا الشهر',
  lastMonth: 'الشهر الماضي',
  thisYear: 'هذا العام',
};

/** Payment statuses. */
export const paymentStatusLabel: Record<string, string> = {
  succeeded: 'مستلمة',
  partially_refunded: 'مسترد جزئيًا',
  refunded: 'مستردة',
  reversed: 'ملغاة (خطأ إدخال)',
  pending: 'معلقة',
  failed: 'فشلت',
};

/** Follow-up reasons. */
export const recallReasonLabel: Record<string, string> = {
  checkup: 'كشف دوري',
  cleaning: 'تنظيف',
  ortho_adjustment: 'ضبط تقويم',
  post_op: 'متابعة بعد جراحة',
  implant_followup: 'متابعة زراعة',
  other: 'أخرى',
};

/** What to write as a payment's reference. */
export const referenceHintLabel: Record<string, string> = {
  card: 'رقم الموافقة إن وُجد',
  bank_transfer: 'رقم عملية التحويل',
  wallet: 'رقم العملية في المحفظة',
  instapay: 'رقم مرجع إنستاباي',
};

/** Who signed a consent (the patient's relation). */
export const signerRelationLabel: Record<string, string> = {
  self: 'المريض نفسه',
  father: 'الأب',
  mother: 'الأم',
  sibling: 'أخ / أخت',
  spouse: 'الزوج / الزوجة',
  legal_guardian: 'وصي قانوني',
  other: 'أخرى',
};

/** Built-in role keys. */
export const roleKeyLabel: Record<string, string> = {
  owner: 'المالك',
  doctor: 'طبيب',
  receptionist: 'الاستقبال',
  assistant: 'مساعد',
  accountant: 'محاسب',
};

/** Where an appointment came from. */
export const appointmentSourceLabel: Record<string, string> = {
  website: 'الموقع',
  dashboard: 'لوحة التحكم',
  phone: 'هاتف',
  walk_in: 'بدون موعد',
  whatsapp: 'واتساب',
};

/** Appointment statuses. */
export const appointmentStatusLabel: Record<string, string> = {
  held: 'محجوز مؤقتًا',
  expired: 'منتهٍ',
  pending: 'بانتظار التأكيد',
  confirmed: 'مؤكد',
  checked_in: 'وصل',
  in_progress: 'جارٍ',
  completed: 'مكتمل',
  cancelled: 'ملغي',
  no_show: 'لم يحضر',
};

/** Tooth surfaces. */
export const toothSurfaceLabel: Record<string, string> = {
  M: 'إنسي (M)',
  O: 'إطباقي (O)',
  D: 'وحشي (D)',
  B: 'شدقي (B)',
  L: 'لساني (L)',
  I: 'قاطع (I)',
  F: 'أمامي (F)',
  P: 'حنكي (P)',
};

/** Field names in validation messages (L10N-003). */
export const validationFieldLabel: Record<string, string> = {
  fullName: 'الاسم',
  name: 'الاسم',
  nameAr: 'الاسم',
  phone: 'رقم الموبايل',
  email: 'البريد الإلكتروني',
  password: 'كلمة المرور',
  code: 'الرمز',
  slug: 'العنوان',
  dateOfBirth: 'تاريخ الميلاد',
  gender: 'النوع',
  amountMinor: 'المبلغ',
  unitPriceMinor: 'السعر',
  priceMinor: 'السعر',
  quantity: 'الكمية',
  reason: 'السبب',
  note: 'الملاحظة',
  description: 'الوصف',
  reference: 'المرجع',
  method: 'طريقة الدفع',
  title: 'العنوان',
  text: 'النص',
  from: 'تاريخ البداية',
  to: 'تاريخ النهاية',
  dueDate: 'تاريخ الاستحقاق',
  spentOn: 'تاريخ المصروف',
  branchId: 'الفرع',
  drugName: 'اسم الدواء',
  lines: 'بنود الفاتورة',
  items: 'البنود',
  installments: 'الأقساط',
};

/**
 * User-facing text for an API error (L10N-003): our own words for the code, else Arabic for its HTTP status — never
 * the server's English `detail`, which is for developers. No status (the network failed) reads as a server error.
 */
export function errorText(code: string, status: number | undefined): string {
  if (code in errorLabel) return errorLabel[code];
  const st = status === undefined || status >= 500 ? 500 : [400, 401, 403, 404, 409, 429].includes(status) ? status : 400;
  return errorLabel[`generic_${st}`];
}

/** A role by its own name (roles are the clinic's, H4); the Arabic label of its key when no name is at hand. */
export const roleLabel = (role: string, name?: string | null): string => name || roleKeyLabel[role] || role;

/** "5 دقائق" but "20 دقيقة": Arabic counts 3–10 with the plural form. */
export const minutesLabel = (n: number): string => (n >= 3 && n <= 10 ? 'دقائق' : 'دقيقة');

/** Catalogue category label; an unknown category shows its code rather than breaking the picker. */
export const categoryLabel = (c: string): string => catalogCategoryLabel[c] ?? c;
