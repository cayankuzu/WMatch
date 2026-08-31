# Moderation operations without an admin panel

WMatch'te yeni admin/moderatör paneli yoktur. Kullanıcı yalnız mevcut profile/chat report ve block
akışını kullanır; review işlemi service-boundary tablo/RPC ve restricted ops bağlantısı üzerinden
yürür.

## Server contract

- `POST /reports` authenticated'dır; profile hedefi reporter'ın kendisi olamaz ve hedef profil
  gerçekten var olmalıdır.
- Reason/target allowlist uygulanır; details uzunluğu 20-1500 karakterdir.
- Limit mevcut kodda kullanıcı/hedef/request identity anahtarında saatte 12 rapordur.
- Mobil client `Idempotency-Key` gönderir. `(reporter_user_id, idempotency_key)` unique index'i ve
  payload hash aynı key/farklı payload'ı `409` ile reddeder.
- `moderation_reports` anon/authenticated erişimine kapalı, service-role boundary'dir. Reviewer
  alanları mobil/PostgREST tarafından mass-assign edilemez.
- Her vaka `sla_due_at=created_at+24h` default'u ve `last_transition_at` taşır. Bu metadata staffing
  veya 24 saat içinde review garantisi değildir; gerçek on-call/SLA kanıtı ayrıca gerekir.
- Insert ve status/reviewer-note değişiklikleri `moderation_report_audit_events` tablosuna append
  edilir. Audit tablosu da service-role-only'dir.
- SMTP yapılandırılmışsa yalnız report ID, target type, reason, created time ve SLA due time gönderir;
  reporter/target snapshot, details veya kullanıcı iletişim bilgisi e-postaya eklenmez. SMTP yoksa
  `mailed=false` döner ama vaka DB'de kalır.

## Durum sözleşmesi

Repository RPC'sinin kabul ettiği değerler: `pending`, `reviewing`, `resolved`, `dismissed`.

| Durum | Anlam | Zorunlu operasyon kaydı |
|---|---|---|
| `pending` | Yeni/yeniden kuyruğa alınmış vaka | Atanmış owner ve intake zamanı |
| `reviewing` | Restricted reviewer incelemesi sürüyor | Actor label, transition zamanı, evidence referansı |
| `resolved` | Mevcut policy kapsamında işlem tamamlandı | Sanitized reviewer note ve karar referansı |
| `dismissed` | Vaka mevcut kanıtla işlem gerektirmiyor | Sanitized gerekçe ve karar referansı |

RPC teknik olarak allowed status'lar arasında transition graph zorlamaz. Operator keyfi reopen/
close yapmamalıdır; policy ve iki kişilik P0 onayı repository dışında tanımlanmadan state transition
olgun kabul edilmez. Sanction veya appeal için ayrı otomasyon/user surface repository'de yoktur ve
varmış gibi işletilmez.

## Restricted intake

Yalnız bastion/approved DB console ve minimum yetkili operasyon rolünden metadata sorgulanır. İlk
liste details/snapshot çekmez:

```sql
SELECT
  id,
  target_type,
  reason_code,
  status,
  created_at,
  sla_due_at,
  last_transition_at
FROM public.moderation_reports
WHERE status IN ('pending', 'reviewing')
ORDER BY sla_due_at ASC, created_at ASC
LIMIT 100;
```

Vaka içeriğine ancak need-to-know reviewer erişir. Details veya snapshot email, Slack, generic ticket,
Sentry ya da Cloudflare loguna kopyalanmaz. Report ID restricted case kaydının korelasyon anahtarıdır.

## Güvenli status transition

Operator transaction içinde report ID, next status, en fazla 2000 karakter sanitized reviewer note
ve kişisel email içermeyen actor label sağlar:

```sql
BEGIN;
SELECT
  (public.transition_moderation_report_ops(
    :'report_id'::uuid,
    :'next_status',
    NULLIF(:'reviewer_notes', ''),
    :'actor_label'
  )).id;
COMMIT;
```

Ardından audit'in oluştuğu doğrulanır:

```sql
SELECT action, from_status, to_status, actor_kind, actor_label, created_at
FROM public.moderation_report_audit_events
WHERE report_id = :'report_id'::uuid
ORDER BY created_at ASC;
```

Yanlış report ID, allowed-list dışı status veya aşırı note transaction'ı fail etmelidir. Hata halinde
elle tablo update etmek yerine transaction rollback edilir ve incident açılır.

## Block ile ilişki

Report otomatik block değildir. Mevcut block akışı ayrı user intent'tir ve discovery/profile/like/
match/chat/message/Realtime/notification görünürlüğünde bilateral olarak uygulanmalıdır. Reviewer
report state'ini değiştirirken kullanıcı adına block/unblock yapmaz. Block tutarlılığı RLS/read-model
ve iki kullanıcı cihaz testleriyle release evidence'a bağlanır.

## Account deletion ve retention

Hesap silme saga'sının `requested` aşaması, kullanıcının reporter veya target olduğu moderation
report'larını siler; audit satırları report FK `ON DELETE CASCADE` nedeniyle silinir. Bu mevcut privacy
davranışıdır. Diğer vakalar için onaylı retention/purge süresi repository'de tanımlı değildir. Data/
legal owner süreyi ve legal-hold istisnasını belirlemeden sınırsız saklama veya otomatik purge
uygulanmış sayılmaz.

## Alert ve SLA işlemi

1. SMTP/provider secrets yalnız Supabase Function secret store'da tutulur.
2. `mailed=false`, overdue `sla_due_at` veya mail provider hatası dashboard/ops sorgusunda görünür
   olmalı; report submission kullanıcıya sahte mail başarısı söylemez.
3. Test report fixture'ı preview'da gönderilir; e-postada details/snapshot/PII olmadığı doğrulanır.
4. Pending/reviewing overdue query'si, gerçek owner ve escalation hedefi test edilir.
5. Provider mail başarısız olsa da vaka DB'den triage edilebilir olmalıdır.

## Evidence ve açıklar

`release-evidence/<SHA>/moderation/` altında sanitized fixture IDs, rate-limit/idempotency sonuçları,
RLS deny matrisi, transition/audit sonucu, SMTP redaction görüntüsü ve owner/SLA alarm testi tutulur.

Şu an migration/function kodu mevcuttur; yeni migration'ın staging/production deploy'u, service-role
attack testi, gerçek SMTP redaction/alert teslimi, reviewer owner/SLA ve retention kararı kanıtlanmış
değildir. Moderasyon release kapısı bu nedenle `NO-GO`dur.
