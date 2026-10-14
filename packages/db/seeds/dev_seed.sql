-- Demo data for local development and tests. Runs as the admin role (bypasses RLS).
--   Clinic A  http://clinic-a.lvh.me:3000   owner.a@demo.test / reception.a@demo.test / doctor.a@demo.test
--   Clinic B  http://clinic-b.lvh.me:3000   owner.b@demo.test
--   Every demo account's password is  Demo@12345  (dev only; hash below is scrypt N=16384 r=8 p=1)
-- Fixed ids so tests and docs can refer to them.
BEGIN;

INSERT INTO plans (id, code, name_en, name_ar, price_monthly_minor, price_yearly_minor, currency, limits, features, sort_order) VALUES
 ('00000000-0000-0000-0000-00000000a001','basic','Basic','الأساسية', 50000, 500000,'EGP',
  '{"branches":1,"staff":5,"patients":2000,"sms_credits":200,"storage_mb":2048}','{"custom_domain":false,"online_payments":false}',1),
 ('00000000-0000-0000-0000-00000000a002','pro','Pro','الاحترافية', 120000, 1200000,'EGP',
  '{"branches":5,"staff":30,"patients":50000,"sms_credits":1000,"storage_mb":20480}','{"custom_domain":true,"online_payments":true,"remove_badge":true}',2)
ON CONFLICT DO NOTHING;  -- also created by migration 0003

INSERT INTO templates (id, code, name, sections_schema, default_theme) VALUES
 ('00000000-0000-0000-0000-00000000b001','smile','Smile','{}','{"primary":"#0E7C86","font_ar":"Cairo","font_en":"Inter"}')
ON CONFLICT DO NOTHING;

INSERT INTO service_catalog (code, category, name_en, name_ar, default_duration_minutes, sort_order) VALUES
 ('consultation','general','Consultation','كشف',20,1),
 ('scaling','preventive','Scaling & polishing','تنظيف الجير والتلميع',45,2),
 ('filling_composite','restorative','Composite filling','حشو تجميلي',45,3),
 ('rct','endodontic','Root canal treatment','علاج عصب',90,4),
 ('whitening','cosmetic','Teeth whitening','تبييض الأسنان',60,5)
ON CONFLICT DO NOTHING;

INSERT INTO tenants (id, slug, name_en, name_ar, status, onboarding_step, primary_phone, whatsapp, specialties, about_en, about_ar) VALUES
 ('11111111-1111-1111-1111-111111111111','clinic-a','Smile Dental Clinic','عيادة الابتسامة لطب الأسنان','trialing',7,
  '+201000000101','+201000000101','{general,cosmetic,orthodontics}','Family dentistry in Cairo since 2015.','طب أسنان للعائلة في القاهرة منذ 2015.'),
 ('22222222-2222-2222-2222-222222222222','clinic-b','Cairo Dental Care','كايرو دنتال كير','trialing',7,
  '+201000000201','+201000000201','{general}','Dental care for everyone.','رعاية أسنان للجميع.');

INSERT INTO tenant_settings (tenant_id, booking_auto_confirm, invoice_prefix) VALUES
 ('11111111-1111-1111-1111-111111111111', true, 'SMA'),
 ('22222222-2222-2222-2222-222222222222', false, 'CDC');

INSERT INTO subscriptions (tenant_id, plan_id, status, trial_ends_at) VALUES
 ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-00000000a002','trialing', now() + interval '14 days'),
 ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-00000000a001','trialing', now() + interval '14 days');

INSERT INTO roles (id, tenant_id, key, name_en, name_ar, is_system, permissions) VALUES
 ('a0000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','owner','Owner','المالك',true,'{*}'),
 ('a0000000-0000-0000-0000-0000000000a2','11111111-1111-1111-1111-111111111111','receptionist','Receptionist','الاستقبال',true,
  '{patients:read,patients:write,appointments:read,appointments:write,appointments:override,invoices:read,invoices:write,payments:write,branches:read}'),
 ('a0000000-0000-0000-0000-0000000000a3','11111111-1111-1111-1111-111111111111','doctor','Doctor','طبيب',true,
  '{patients:read,patients:write,appointments:read,appointments:write:own,clinical:write,branches:read}'),
 ('a0000000-0000-0000-0000-0000000000b1','22222222-2222-2222-2222-222222222222','owner','Owner','المالك',true,'{*}');

INSERT INTO users (id, email, phone, full_name, locale, email_verified_at, phone_verified_at, password_hash) VALUES
 ('b0000000-0000-0000-0000-0000000000a1','owner.a@demo.test','+201000000111','Dr. Ahmed Salah','ar',now(),now(),'scrypt$16384$8$1$XR8Mmns+Kkxtjg8aKzxNXg$1En43/A2aEoMRt+cxNHwQj86koqxwvSXbeb5/BVQXuL2kCc/oMGPI1zOjJ1v/2ZMy4Y5u/fBRI0NZtpq3RA84A'),
 ('b0000000-0000-0000-0000-0000000000a2','reception.a@demo.test','+201000000112','Sara Mohamed','ar',now(),now(),'scrypt$16384$8$1$XR8Mmns+Kkxtjg8aKzxNXg$1En43/A2aEoMRt+cxNHwQj86koqxwvSXbeb5/BVQXuL2kCc/oMGPI1zOjJ1v/2ZMy4Y5u/fBRI0NZtpq3RA84A'),
 ('b0000000-0000-0000-0000-0000000000a3','doctor.a@demo.test','+201000000113','Dr. Mona Hassan','ar',now(),now(),'scrypt$16384$8$1$XR8Mmns+Kkxtjg8aKzxNXg$1En43/A2aEoMRt+cxNHwQj86koqxwvSXbeb5/BVQXuL2kCc/oMGPI1zOjJ1v/2ZMy4Y5u/fBRI0NZtpq3RA84A'),
 ('b0000000-0000-0000-0000-0000000000b1','owner.b@demo.test','+201000000211','Dr. Karim Adel','ar',now(),now(),'scrypt$16384$8$1$XR8Mmns+Kkxtjg8aKzxNXg$1En43/A2aEoMRt+cxNHwQj86koqxwvSXbeb5/BVQXuL2kCc/oMGPI1zOjJ1v/2ZMy4Y5u/fBRI0NZtpq3RA84A');

INSERT INTO tenant_members (id, tenant_id, user_id, role_id) VALUES
 ('c0000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','b0000000-0000-0000-0000-0000000000a1','a0000000-0000-0000-0000-0000000000a1'),
 ('c0000000-0000-0000-0000-0000000000a2','11111111-1111-1111-1111-111111111111','b0000000-0000-0000-0000-0000000000a2','a0000000-0000-0000-0000-0000000000a2'),
 ('c0000000-0000-0000-0000-0000000000a3','11111111-1111-1111-1111-111111111111','b0000000-0000-0000-0000-0000000000a3','a0000000-0000-0000-0000-0000000000a3'),
 ('c0000000-0000-0000-0000-0000000000b1','22222222-2222-2222-2222-222222222222','b0000000-0000-0000-0000-0000000000b1','a0000000-0000-0000-0000-0000000000b1');

INSERT INTO branches (id, tenant_id, name_en, name_ar, slug, address_en, address_ar, city, latitude, longitude, phone, is_main) VALUES
 ('d0000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','Nasr City','مدينة نصر','nasr-city',
  '12 Abbas El Akkad St','12 شارع عباس العقاد','Cairo',30.059,31.338,'+201000000101',true),
 ('d0000000-0000-0000-0000-0000000000a2','11111111-1111-1111-1111-111111111111','Maadi','المعادي','maadi',
  '9 Road 9','9 شارع 9','Cairo',29.960,31.257,'+201000000102',false),
 ('d0000000-0000-0000-0000-0000000000b1','22222222-2222-2222-2222-222222222222','Heliopolis','مصر الجديدة','heliopolis',
  '5 Baghdad St','5 شارع بغداد','Cairo',30.090,31.322,'+201000000201',true);

-- Saturday (6) to Thursday (4), 10:00-14:00 and 17:00-22:00; Friday closed
INSERT INTO branch_hours (tenant_id, branch_id, weekday, opens_at, closes_at)
SELECT b.tenant_id, b.id, d, t.o, t.c
FROM branches b, unnest(ARRAY[6,0,1,2,3,4]) d, (VALUES ('10:00'::time,'14:00'::time),('17:00','22:00')) t(o,c);

INSERT INTO rooms (id, tenant_id, branch_id, name) VALUES
 ('e0000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','Chair 1'),
 ('e0000000-0000-0000-0000-0000000000a2','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','Chair 2'),
 ('e0000000-0000-0000-0000-0000000000a3','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a2','Chair 1');

INSERT INTO doctors (id, tenant_id, member_id, name_en, name_ar, title_en, title_ar, specialties, consultation_fee_minor, commission_bp) VALUES
 ('f0000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','c0000000-0000-0000-0000-0000000000a1',
  'Dr. Ahmed Salah','د. أحمد صلاح','Implantologist','أخصائي زراعة الأسنان','{implants,surgery}',30000,4000),
 ('f0000000-0000-0000-0000-0000000000a2','11111111-1111-1111-1111-111111111111','c0000000-0000-0000-0000-0000000000a3',
  'Dr. Mona Hassan','د. منى حسن','Orthodontist','أخصائية تقويم الأسنان','{orthodontics}',30000,3000),
 ('f0000000-0000-0000-0000-0000000000b1','22222222-2222-2222-2222-222222222222','c0000000-0000-0000-0000-0000000000b1',
  'Dr. Karim Adel','د. كريم عادل','General dentist','طبيب أسنان عام','{general}',20000,0);

INSERT INTO doctor_branches (tenant_id, doctor_id, branch_id) VALUES
 ('11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a1'),
 ('11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-0000000000a2','d0000000-0000-0000-0000-0000000000a1'),
 ('11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-0000000000a2','d0000000-0000-0000-0000-0000000000a2'),
 ('22222222-2222-2222-2222-222222222222','f0000000-0000-0000-0000-0000000000b1','d0000000-0000-0000-0000-0000000000b1');

INSERT INTO doctor_schedules (tenant_id, doctor_id, branch_id, weekday, starts_at, ends_at)
SELECT db.tenant_id, db.doctor_id, db.branch_id, d, '17:00', '22:00'
FROM doctor_branches db, unnest(ARRAY[6,0,1,2,3,4]) d
WHERE db.doctor_id <> 'f0000000-0000-0000-0000-0000000000a2' OR db.branch_id = 'd0000000-0000-0000-0000-0000000000a1';

INSERT INTO services (id, tenant_id, catalog_code, name_en, name_ar, price_minor, price_max_minor, duration_minutes, sort_order) VALUES
 ('90000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','consultation','Consultation','كشف',30000,NULL,20,1),
 ('90000000-0000-0000-0000-0000000000a2','11111111-1111-1111-1111-111111111111','scaling','Scaling & polishing','تنظيف الجير والتلميع',60000,NULL,45,2),
 ('90000000-0000-0000-0000-0000000000a3','11111111-1111-1111-1111-111111111111','filling_composite','Composite filling','حشو تجميلي',80000,120000,45,3),
 ('90000000-0000-0000-0000-0000000000a4','11111111-1111-1111-1111-111111111111','whitening','Teeth whitening','تبييض الأسنان',350000,NULL,60,4),
 ('90000000-0000-0000-0000-0000000000b1','22222222-2222-2222-2222-222222222222','consultation','Consultation','كشف',20000,NULL,20,1);

INSERT INTO doctor_services (tenant_id, doctor_id, service_id)
SELECT s.tenant_id, d.id, s.id FROM services s JOIN doctors d ON d.tenant_id = s.tenant_id;

INSERT INTO sites (tenant_id, template_id, status, draft_theme, published_theme, published_version, published_at) VALUES
 ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-00000000b001','published','{"primary":"#0E7C86"}','{"primary":"#0E7C86"}',1,now()),
 ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-00000000b001','published','{"primary":"#7C3AED"}','{"primary":"#7C3AED"}',1,now());

INSERT INTO domains (tenant_id, hostname, type, status, is_primary, verified_at) VALUES
 ('11111111-1111-1111-1111-111111111111','clinic-a.lvh.me','subdomain','active',true,now()),
 ('22222222-2222-2222-2222-222222222222','clinic-b.lvh.me','subdomain','active',true,now());

INSERT INTO tenant_counters (tenant_id, key, value) VALUES
 ('11111111-1111-1111-1111-111111111111','patient_file',2),
 ('22222222-2222-2222-2222-222222222222','patient_file',1);

INSERT INTO patients (id, tenant_id, file_no, full_name, gender, phone, email, preferred_branch_id) VALUES
 ('70000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111',1,'Omar Khaled','male','+201011111111','omar@example.test','d0000000-0000-0000-0000-0000000000a1'),
 ('70000000-0000-0000-0000-0000000000a2','11111111-1111-1111-1111-111111111111',2,'Nour Ali','female','+201022222222',NULL,'d0000000-0000-0000-0000-0000000000a1'),
 ('70000000-0000-0000-0000-0000000000b1','22222222-2222-2222-2222-222222222222',1,'Youssef Samir','male','+201033333333',NULL,'d0000000-0000-0000-0000-0000000000b1');

COMMIT;
