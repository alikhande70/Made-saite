/**
 * IndexNow adapter — https://www.indexnow.org/documentation
 *
 * IndexNow is a shared protocol rather than one company's API: a single
 * submission is forwarded to every participating engine (Bing, Yandex, Seznam,
 * Naver and others). That is why it is the first adapter — one integration,
 * several engines, and no per-engine credentials to obtain. Google does not
 * participate; Google discovers changes through the sitemap and Search Console,
 * which is why the sitemap is the load-bearing part of this subsystem and
 * IndexNow is an accelerator on top of it.
 *
 * Protocol facts this file depends on, quoted from the specification:
 *   - the key is 8–128 characters from [a-zA-Z0-9-];
 *   - the key file lives at `https://<host>/<key>.txt` and contains only the key;
 *   - batch submission is `POST /indexnow` with a JSON body of
 *     `{ host, key, keyLocation, urlList }`, at most 10,000 URLs;
 *   - 200 = accepted, 202 = accepted with key validation pending,
 *     400 = bad request, 403 = key not valid, 422 = URL/host mismatch,
 *     429 = too many requests.
 *
 * 202 is a success. Treating it as a failure would retry a submission the
 * engine already has, which is exactly the behaviour 429 exists to punish.
 */
import { isRetryableStatus } from '@/domain/search-visibility';
import { logEvent } from '@/lib/observability';
import type { AdapterConfigStatus, SearchEngineAdapter, SubmissionOutcome } from './adapter';

/** Shared endpoint; participating engines forward between themselves. */
const ENDPOINT = 'https://api.indexnow.org/indexnow';

/** Protocol maximum. */
const MAX_BATCH = 10_000;

/**
 * A search engine being slow must not hold a background worker open. The
 * submission is a hint, not a transaction — if it times out we retry later.
 */
const TIMEOUT_MS = 10_000;

const KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

export function isValidIndexNowKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

/** The key file path the specification requires, given a key. */
export function indexNowKeyFilePath(key: string): string {
  return `/${key}.txt`;
}

export class IndexNowAdapter implements SearchEngineAdapter {
  readonly id = 'indexnow';
  readonly displayNameFa = 'IndexNow (Bing، Yandex و سایر موتورهای عضو)';
  readonly supportsInstantSubmission = true;
  readonly maxBatchSize = MAX_BATCH;

  constructor(
    private readonly getKey: () => string | undefined = () => process.env.INDEXNOW_KEY,
    private readonly getSiteUrl: () => string = () => process.env.SITE_URL ?? '',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  validateConfiguration(): AdapterConfigStatus {
    const key = this.getKey();
    if (!key) {
      return { configured: false, reasonFa: 'کلید INDEXNOW_KEY تنظیم نشده است.' };
    }
    if (!isValidIndexNowKey(key)) {
      return {
        configured: false,
        reasonFa: 'کلید INDEXNOW_KEY معتبر نیست: باید ۸ تا ۱۲۸ نویسه از حروف، ارقام یا خط تیره باشد.',
      };
    }
    const site = this.getSiteUrl();
    if (!site.startsWith('https://')) {
      // The key file must be fetchable by the engine over HTTPS at the real
      // domain; a localhost or http:// origin cannot be validated, so
      // submitting from one only earns 403s.
      return {
        configured: false,
        reasonFa: 'برای ارسال به موتورهای جست‌وجو، SITE_URL باید یک دامنهٔ واقعی با HTTPS باشد.',
      };
    }
    return { configured: true, reasonFa: null };
  }

  async submitUrl(url: string): Promise<SubmissionOutcome> {
    return this.submitBatch([url]);
  }

  async submitBatch(urls: readonly string[]): Promise<SubmissionOutcome> {
    const status = this.validateConfiguration();
    if (!status.configured) {
      // Not retryable: no amount of waiting configures a key. The outbox parks
      // these so the admin sees why nothing is being submitted.
      return { ok: false, status: null, retryable: false, message: status.reasonFa ?? 'پیکربندی نشده است.' };
    }
    if (urls.length === 0) {
      return { ok: true, status: null, retryable: false, message: 'چیزی برای ارسال نبود.' };
    }
    if (urls.length > MAX_BATCH) {
      return {
        ok: false, status: null, retryable: false,
        message: `تعداد نشانی‌ها بیش از حد مجاز پروتکل است (${MAX_BATCH}).`,
      };
    }

    const key = this.getKey()!;
    const site = new URL(this.getSiteUrl());
    const body = JSON.stringify({
      host: site.host,
      key,
      keyLocation: `${site.origin}${indexNowKeyFilePath(key)}`,
      urlList: urls,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body,
        signal: controller.signal,
      });

      // 200 accepted, 202 accepted pending key validation. Both are done.
      if (response.status === 200 || response.status === 202) {
        logEvent('info', {
          event: 'seo.submission.succeeded',
          adapter: this.id,
          status: response.status,
          urlCount: urls.length,
        });
        return { ok: true, status: response.status, retryable: false, message: `پذیرفته شد (${response.status}).` };
      }

      const retryable = isRetryableStatus(response.status);
      const message = describeStatus(response.status);
      logEvent('warn', {
        event: 'seo.submission.failed',
        adapter: this.id,
        status: response.status,
        retryable,
        urlCount: urls.length,
      });
      return { ok: false, status: response.status, retryable, message };
    } catch (error) {
      // Network failure or timeout — always worth another attempt.
      const message = error instanceof Error && error.name === 'AbortError'
        ? 'زمان پاسخ درگاه به پایان رسید.'
        : 'ارتباط با سرویس برقرار نشد.';
      logEvent('warn', { event: 'seo.submission.failed', adapter: this.id, status: null, retryable: true });
      return { ok: false, status: null, retryable: true, message };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Persian explanations for the status codes the specification defines. */
function describeStatus(status: number): string {
  switch (status) {
    case 400: return 'درخواست نامعتبر بود (۴۰۰).';
    case 403: return 'کلید پذیرفته نشد یا فایل کلید در دسترس نیست (۴۰۳).';
    case 422: return 'نشانی‌ها با دامنهٔ کلید هم‌خوانی ندارند (۴۲۲).';
    case 429: return 'تعداد درخواست‌ها بیش از حد مجاز بود (۴۲۹).';
    default: return `پاسخ غیرمنتظره از سرویس (${status}).`;
  }
}
