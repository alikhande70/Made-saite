'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { VehicleBrandNode } from '@/application/catalog-service';
import { toLatinDigits, toPersianDigits, formatToman } from '@/lib/fa';
import { Alert, Button, CloseIcon, LatinId } from '../ui';

export interface ProductFormValues {
  sku: string;
  oemNumber: string;
  mpn: string;
  slug: string;
  titleFa: string;
  titleEn: string;
  descriptionFa: string;
  categoryId: string;
  brandId: string;
  manufacturer: string;
  price: string;
  salePrice: string;
  weightGrams: string;
  lengthMm: string;
  widthMm: string;
  heightMm: string;
  warrantyMonths: string;
  countryOfOrigin: string;
  condition: 'new' | 'refurbished' | 'used';
  installationNotes: string;
  tags: string;
  seoTitle: string;
  seoDescription: string;
  isActive: boolean;
  initialStock: string;
  productFamily: string;
  allowBackorder: boolean;
}

export interface SpecRow { specKey: string; specValue: string; unit: string }
export interface ImageRow { url: string; alt: string }
export interface FitmentRow {
  vehicleModelId: string;
  vehicleTrimId: string;
  vehicleEngineId: string;
  yearFrom: string;
  yearTo: string;
  fitmentType: 'DIRECT' | 'WITH_MODIFICATION' | 'NOT_COMPATIBLE';
  note: string;
}

export interface ReferenceRow {
  relationType: 'SUPERSEDES' | 'SUPERSEDED_BY' | 'ALTERNATE' | 'CROSS_REFERENCE';
  targetNumber: string;
  targetBrand: string;
  note: string;
}

const EMPTY: ProductFormValues = {
  sku: '', oemNumber: '', mpn: '', slug: '', titleFa: '', titleEn: '', descriptionFa: '',
  categoryId: '', brandId: '', manufacturer: '', price: '', salePrice: '',
  weightGrams: '', lengthMm: '', widthMm: '', heightMm: '', warrantyMonths: '',
  countryOfOrigin: '', condition: 'new', installationNotes: '', tags: '',
  seoTitle: '', seoDescription: '', isActive: false, initialStock: '',
  productFamily: '', allowBackorder: false,
};

/** The illustrations shipped with the demo catalogue, offered as image choices. */
const DEMO_IMAGES = [
  'oil-filter', 'air-filter', 'cabin-filter', 'fuel-filter', 'brake-pad', 'brake-disc',
  'spark-plug', 'battery', 'timing-belt', 'v-belt', 'shock-absorber', 'ball-joint',
  'engine-part', 'motor-oil', 'gear-oil', 'headlight', 'body-panel', 'alternator',
].map((name) => `/demo/${name}.svg`);

const num = (v: string): number | null => {
  const cleaned = toLatinDigits(v).replace(/[^\d-]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

export function ProductForm({
  productId, initialValues, initialSpecs, initialImages, initialFitments, initialReferences,
  categories, brands, vehicles, currentStock,
}: {
  productId?: string;
  initialValues?: Partial<ProductFormValues>;
  initialSpecs?: SpecRow[];
  initialImages?: ImageRow[];
  initialFitments?: FitmentRow[];
  initialReferences?: ReferenceRow[];
  categories: { id: string; nameFa: string; parentId: string | null }[];
  brands: { id: string; nameFa: string }[];
  vehicles: VehicleBrandNode[];
  currentStock?: { onHand: number; reserved: number } | null;
}) {
  const router = useRouter();
  const [values, setValues] = useState<ProductFormValues>({ ...EMPTY, ...initialValues });
  const [specs, setSpecs] = useState<SpecRow[]>(initialSpecs ?? []);
  const [images, setImages] = useState<ImageRow[]>(initialImages ?? []);
  const [fitments, setFitments] = useState<FitmentRow[]>(initialFitments ?? []);
  const [references, setReferences] = useState<ReferenceRow[]>(initialReferences ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const allModels = vehicles.flatMap((b) => b.models.map((m) => ({ ...m, brandName: b.nameFa })));

  function set<K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    setErrors({});

    const payload = {
      sku: values.sku.trim(),
      oemNumber: values.oemNumber.trim() || undefined,
      mpn: values.mpn.trim() || undefined,
      slug: values.slug.trim() || undefined,
      titleFa: values.titleFa.trim(),
      titleEn: values.titleEn.trim() || undefined,
      descriptionFa: values.descriptionFa.trim() || undefined,
      categoryId: values.categoryId || undefined,
      brandId: values.brandId || undefined,
      manufacturer: values.manufacturer.trim() || undefined,
      price: num(values.price) ?? 0,
      salePrice: num(values.salePrice),
      weightGrams: num(values.weightGrams),
      lengthMm: num(values.lengthMm),
      widthMm: num(values.widthMm),
      heightMm: num(values.heightMm),
      warrantyMonths: num(values.warrantyMonths),
      countryOfOrigin: values.countryOfOrigin.trim() || undefined,
      condition: values.condition,
      installationNotes: values.installationNotes.trim() || undefined,
      tags: values.tags.split(/[,،]/).map((t) => t.trim()).filter(Boolean),
      seoTitle: values.seoTitle.trim() || undefined,
      seoDescription: values.seoDescription.trim() || undefined,
      isActive: values.isActive,
      images: images.filter((i) => i.url.trim()).map((i) => ({ url: i.url.trim(), alt: i.alt.trim() || undefined })),
      specs: specs.filter((s) => s.specKey.trim() && s.specValue.trim())
        .map((s) => ({ specKey: s.specKey.trim(), specValue: s.specValue.trim(), unit: s.unit.trim() || undefined })),
      productFamily: values.productFamily.trim() || undefined,
      allowBackorder: values.allowBackorder,
      fitments: fitments.filter((f) => f.vehicleModelId).map((f) => ({
        vehicleModelId: f.vehicleModelId,
        vehicleTrimId: f.vehicleTrimId || null,
        vehicleEngineId: f.vehicleEngineId || null,
        yearFrom: num(f.yearFrom),
        yearTo: num(f.yearTo),
        fitmentType: f.fitmentType,
        note: f.note.trim() || null,
      })),
      references: references.filter((r) => r.targetNumber.trim()).map((r) => ({
        relationType: r.relationType,
        targetNumber: r.targetNumber.trim(),
        targetBrand: r.targetBrand.trim() || null,
        note: r.note.trim() || null,
      })),
      ...(productId ? {} : { initialStock: num(values.initialStock) ?? 0 }),
    };

    try {
      const res = await fetch(productId ? `/api/admin/products/${productId}` : '/api/admin/products', {
        method: productId ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as {
        ok: boolean; message?: string; fields?: Record<string, string>; data?: { id: string };
      };
      if (!res.ok || !body.ok) {
        setFormError(body.message ?? 'ذخیرهٔ کالا انجام نشد.');
        if (body.fields) setErrors(body.fields);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      router.push(productId ? `/admin/products/${productId}` : `/admin/products/${body.data!.id}`);
      router.refresh();
    } catch {
      setFormError('ارتباط با سرور برقرار نشد.');
    } finally {
      setBusy(false);
    }
  }

  const priceNumber = num(values.price);
  const salePriceNumber = num(values.salePrice);

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {formError && <Alert tone="error" title="ذخیره انجام نشد">{formError}</Alert>}

      <Panel title="اطلاعات پایه">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="titleFa" label="عنوان فارسی" error={errors.titleFa} required>
            <input id="titleFa" className="field" value={values.titleFa} onChange={(e) => set('titleFa', e.target.value)} />
          </Field>
          <Field id="titleEn" label="نام فنی انگلیسی (اختیاری)" error={errors.titleEn}>
            <input id="titleEn" dir="ltr" className="field latin-id" value={values.titleEn} onChange={(e) => set('titleEn', e.target.value)} />
          </Field>
          <Field id="sku" label="کد کالا (SKU)" error={errors.sku} required hint="فقط حروف لاتین، رقم و «- _ . /»">
            <input id="sku" dir="ltr" className="field latin-id" value={values.sku} onChange={(e) => set('sku', e.target.value)} />
          </Field>
          <Field id="oemNumber" label="شمارهٔ OEM" error={errors.oemNumber}>
            <input id="oemNumber" dir="ltr" className="field latin-id" value={values.oemNumber} onChange={(e) => set('oemNumber', e.target.value)} />
          </Field>
          <Field id="mpn" label="کد سازنده (MPN)" error={errors.mpn}>
            <input id="mpn" dir="ltr" className="field latin-id" value={values.mpn} onChange={(e) => set('mpn', e.target.value)} />
          </Field>
          <Field id="slug" label="نشانی یکتا (slug)" error={errors.slug} hint="خالی بگذارید تا از عنوان ساخته شود.">
            <input id="slug" className="field" value={values.slug} onChange={(e) => set('slug', e.target.value)} />
          </Field>
          <Field id="categoryId" label="دسته‌بندی" error={errors.categoryId}>
            <select id="categoryId" className="field" value={values.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
              <option value="">— بدون دسته —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.parentId ? `— ${c.nameFa}` : c.nameFa}</option>
              ))}
            </select>
          </Field>
          <Field id="brandId" label="برند" error={errors.brandId}>
            <select id="brandId" className="field" value={values.brandId} onChange={(e) => set('brandId', e.target.value)}>
              <option value="">— بدون برند —</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.nameFa}</option>)}
            </select>
          </Field>
          <Field id="manufacturer" label="سازنده" error={errors.manufacturer}>
            <input id="manufacturer" className="field" value={values.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} />
          </Field>
          <Field id="countryOfOrigin" label="کشور سازنده" error={errors.countryOfOrigin}>
            <input id="countryOfOrigin" className="field" value={values.countryOfOrigin} onChange={(e) => set('countryOfOrigin', e.target.value)} />
          </Field>
          <Field id="productFamily" label="خانوادهٔ قطعه" error={errors.productFamily}
            hint="قطعات هم‌خانواده در صفحهٔ محصول به‌عنوان جایگزین پیشنهاد می‌شوند.">
            <input id="productFamily" dir="ltr" className="field latin-id" value={values.productFamily}
              onChange={(e) => set('productFamily', e.target.value)} placeholder="brake-pad-front-206" />
          </Field>
          <div className="sm:col-span-2">
            <Field id="descriptionFa" label="توضیحات فارسی" error={errors.descriptionFa}>
              <textarea id="descriptionFa" rows={5} className="field resize-y" value={values.descriptionFa}
                onChange={(e) => set('descriptionFa', e.target.value)} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field id="installationNotes" label="نکات نصب" error={errors.installationNotes}>
              <textarea id="installationNotes" rows={2} className="field resize-y" value={values.installationNotes}
                onChange={(e) => set('installationNotes', e.target.value)} />
            </Field>
          </div>
        </div>
      </Panel>

      <Panel title="قیمت و وضعیت">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field id="price" label="قیمت (تومان)" error={errors.price} required
            hint={priceNumber !== null ? formatToman(priceNumber) : undefined}>
            <input id="price" inputMode="numeric" className="field tabular-nums" value={values.price}
              onChange={(e) => set('price', e.target.value)} />
          </Field>
          <Field id="salePrice" label="قیمت فروش ویژه (تومان)" error={errors.salePrice}
            hint={salePriceNumber !== null ? formatToman(salePriceNumber) : 'خالی = بدون تخفیف'}>
            <input id="salePrice" inputMode="numeric" className="field tabular-nums" value={values.salePrice}
              onChange={(e) => set('salePrice', e.target.value)} />
          </Field>
          <Field id="warrantyMonths" label="ضمانت (ماه)" error={errors.warrantyMonths}>
            <input id="warrantyMonths" inputMode="numeric" className="field tabular-nums" value={values.warrantyMonths}
              onChange={(e) => set('warrantyMonths', e.target.value)} />
          </Field>
          <Field id="condition" label="وضعیت کالا" error={errors.condition}>
            <select id="condition" className="field" value={values.condition}
              onChange={(e) => set('condition', e.target.value as ProductFormValues['condition'])}>
              <option value="new">نو</option>
              <option value="refurbished">بازسازی‌شده</option>
              <option value="used">کارکرده</option>
            </select>
          </Field>

          {!productId ? (
            <Field id="initialStock" label="موجودی اولیه" error={errors.initialStock}
              hint="پس از ایجاد، موجودی از بخش انبار تغییر می‌کند.">
              <input id="initialStock" inputMode="numeric" className="field tabular-nums" value={values.initialStock}
                onChange={(e) => set('initialStock', e.target.value)} />
            </Field>
          ) : (
            currentStock && (
              <div>
                <span className="label">موجودی فعلی</span>
                <p className="rounded-lg bg-steel-50 px-3 py-2.5 text-sm">
                  {toPersianDigits(currentStock.onHand)} عدد در انبار
                  {currentStock.reserved > 0 && (
                    <span className="text-muted"> ({toPersianDigits(currentStock.reserved)} رزرو‌شده)</span>
                  )}
                </p>
                <p className="hint">تغییر موجودی از بخش «انبار و موجودی» انجام می‌شود.</p>
              </div>
            )
          )}

          <div className="content-end space-y-2">
            <label className="flex items-center gap-2 rounded-lg border border-line px-3 py-2.5 text-sm">
              <input type="checkbox" checked={values.isActive} onChange={(e) => set('isActive', e.target.checked)}
                className="size-4 rounded border-steel-300 text-steel-700" />
              انتشار در فروشگاه
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-line px-3 py-2.5 text-sm">
              <input type="checkbox" checked={values.allowBackorder} onChange={(e) => set('allowBackorder', e.target.checked)}
                className="size-4 rounded border-steel-300 text-steel-700" />
              اجازهٔ پیش‌خرید بدون موجودی
            </label>
          </div>
        </div>
      </Panel>

      <Panel title="ابعاد و وزن">
        <div className="grid gap-4 sm:grid-cols-4">
          <Field id="weightGrams" label="وزن (گرم)" error={errors.weightGrams}>
            <input id="weightGrams" inputMode="numeric" className="field tabular-nums" value={values.weightGrams}
              onChange={(e) => set('weightGrams', e.target.value)} />
          </Field>
          <Field id="lengthMm" label="طول (میلی‌متر)" error={errors.lengthMm}>
            <input id="lengthMm" inputMode="numeric" className="field tabular-nums" value={values.lengthMm}
              onChange={(e) => set('lengthMm', e.target.value)} />
          </Field>
          <Field id="widthMm" label="عرض (میلی‌متر)" error={errors.widthMm}>
            <input id="widthMm" inputMode="numeric" className="field tabular-nums" value={values.widthMm}
              onChange={(e) => set('widthMm', e.target.value)} />
          </Field>
          <Field id="heightMm" label="ارتفاع (میلی‌متر)" error={errors.heightMm}>
            <input id="heightMm" inputMode="numeric" className="field tabular-nums" value={values.heightMm}
              onChange={(e) => set('heightMm', e.target.value)} />
          </Field>
        </div>
        <p className="hint mt-2">وزن در محاسبهٔ هزینهٔ ارسال استفاده می‌شود.</p>
      </Panel>

      <Panel title="تصاویر" action={
        <Button type="button" size="sm" variant="secondary" onClick={() => setImages((r) => [...r, { url: '', alt: '' }])}>
          افزودن تصویر
        </Button>
      }>
        {images.length === 0 && <p className="text-sm text-muted">هنوز تصویری اضافه نشده است.</p>}
        <ul className="space-y-3">
          {images.map((image, i) => (
            <li key={i} className="flex flex-wrap items-end gap-2 rounded-lg border border-line p-3">
              {image.url && (
                 
                <img src={image.url} alt="" className="size-14 rounded-md border border-line object-contain" />
              )}
              <div className="min-w-48 flex-1">
                <label htmlFor={`img-url-${i}`} className="label">نشانی تصویر</label>
                <select id={`img-url-${i}`} className="field h-10" value={image.url}
                  onChange={(e) => setImages((r) => r.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}>
                  <option value="">— انتخاب کنید —</option>
                  {DEMO_IMAGES.map((url) => <option key={url} value={url}>{url}</option>)}
                </select>
              </div>
              <div className="min-w-40 flex-1">
                <label htmlFor={`img-alt-${i}`} className="label">متن جایگزین</label>
                <input id={`img-alt-${i}`} className="field h-10" value={image.alt}
                  onChange={(e) => setImages((r) => r.map((x, j) => (j === i ? { ...x, alt: e.target.value } : x)))} />
              </div>
              <button type="button" onClick={() => setImages((r) => r.filter((_, j) => j !== i))}
                aria-label={`حذف تصویر ${i + 1}`} className="mb-1 rounded-lg p-2 text-steel-400 hover:bg-red-50 hover:text-red-600">
                <CloseIcon className="size-4" />
              </button>
              {i === 0 && <span className="mb-2 rounded bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-800">تصویر اصلی</span>}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="مشخصات فنی" action={
        <Button type="button" size="sm" variant="secondary" onClick={() => setSpecs((r) => [...r, { specKey: '', specValue: '', unit: '' }])}>
          افزودن مشخصه
        </Button>
      }>
        {specs.length === 0 && <p className="text-sm text-muted">هنوز مشخصه‌ای اضافه نشده است.</p>}
        <ul className="space-y-2">
          {specs.map((spec, i) => (
            <li key={i} className="flex flex-wrap items-end gap-2">
              <div className="min-w-32 flex-1">
                <label htmlFor={`spec-k-${i}`} className="label">عنوان</label>
                <input id={`spec-k-${i}`} className="field h-10" value={spec.specKey} placeholder="مثال: قطر"
                  onChange={(e) => setSpecs((r) => r.map((x, j) => (j === i ? { ...x, specKey: e.target.value } : x)))} />
              </div>
              <div className="min-w-32 flex-1">
                <label htmlFor={`spec-v-${i}`} className="label">مقدار</label>
                <input id={`spec-v-${i}`} className="field h-10" value={spec.specValue} placeholder="مثال: ۲۸۰"
                  onChange={(e) => setSpecs((r) => r.map((x, j) => (j === i ? { ...x, specValue: e.target.value } : x)))} />
              </div>
              <div className="w-28">
                <label htmlFor={`spec-u-${i}`} className="label">واحد</label>
                <input id={`spec-u-${i}`} className="field h-10" value={spec.unit} placeholder="میلی‌متر"
                  onChange={(e) => setSpecs((r) => r.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} />
              </div>
              <button type="button" onClick={() => setSpecs((r) => r.filter((_, j) => j !== i))}
                aria-label={`حذف مشخصهٔ ${i + 1}`} className="mb-1 rounded-lg p-2 text-steel-400 hover:bg-red-50 hover:text-red-600">
                <CloseIcon className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="سازگاری با خودرو" action={
        <Button type="button" size="sm" variant="secondary"
          onClick={() => setFitments((r) => [...r, {
            vehicleModelId: '', vehicleTrimId: '', vehicleEngineId: '',
            yearFrom: '', yearTo: '', fitmentType: 'DIRECT', note: '',
          }])}>
          افزودن خودرو
        </Button>
      }>
        {fitments.length === 0 && (
          <p className="text-sm text-muted">
            هیچ خودرویی ثبت نشده است. بدون این اطلاعات، کالا در فیلتر «انتخاب بر اساس خودرو» دیده نمی‌شود و
            پاسخ «سازگار است؟» در صفحهٔ محصول «اطلاعات کافی نیست» خواهد بود.
          </p>
        )}
        <ul className="space-y-2">
          {fitments.map((fit, i) => {
            const model = allModels.find((m) => m.id === fit.vehicleModelId);
            const update = (patch: Partial<FitmentRow>) =>
              setFitments((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <li key={i} className={`rounded-lg border p-3 ${
                fit.fitmentType === 'NOT_COMPATIBLE' ? 'border-red-200 bg-red-50/50' : 'border-line'
              }`}>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-44 flex-1">
                    <label htmlFor={`fit-m-${i}`} className="label">مدل خودرو</label>
                    <select id={`fit-m-${i}`} className="field h-10" value={fit.vehicleModelId}
                      onChange={(e) => update({ vehicleModelId: e.target.value, vehicleTrimId: '', vehicleEngineId: '' })}>
                      <option value="">— انتخاب کنید —</option>
                      {vehicles.map((brand) => (
                        <optgroup key={brand.slug} label={brand.nameFa}>
                          {brand.models.map((m) => <option key={m.id} value={m.id}>{m.nameFa}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  <div className="w-36">
                    <label htmlFor={`fit-t-${i}`} className="label">تیپ</label>
                    <TrimSelect id={`fit-t-${i}`} modelSlug={model?.slug ?? null}
                      value={fit.vehicleTrimId} onChange={(v) => update({ vehicleTrimId: v })} />
                  </div>
                  <div className="w-36">
                    <label htmlFor={`fit-e-${i}`} className="label">موتور</label>
                    <EngineSelect id={`fit-e-${i}`} modelSlug={model?.slug ?? null}
                      value={fit.vehicleEngineId} onChange={(v) => update({ vehicleEngineId: v })} />
                  </div>
                  <div className="w-24">
                    <label htmlFor={`fit-yf-${i}`} className="label">از سال</label>
                    <input id={`fit-yf-${i}`} inputMode="numeric" className="field h-10 tabular-nums"
                      value={fit.yearFrom} onChange={(e) => update({ yearFrom: e.target.value })} placeholder="۱۳۹۰" />
                  </div>
                  <div className="w-24">
                    <label htmlFor={`fit-yt-${i}`} className="label">تا سال</label>
                    <input id={`fit-yt-${i}`} inputMode="numeric" className="field h-10 tabular-nums"
                      value={fit.yearTo} onChange={(e) => update({ yearTo: e.target.value })} placeholder="۱۴۰۲" />
                  </div>
                  <button type="button" onClick={() => setFitments((r) => r.filter((_, j) => j !== i))}
                    aria-label={`حذف خودروی ${i + 1}`} className="mb-1 rounded-lg p-2 text-steel-400 hover:bg-red-50 hover:text-red-600">
                    <CloseIcon className="size-4" />
                  </button>
                </div>

                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <div className="w-44">
                    <label htmlFor={`fit-type-${i}`} className="label">نوع سازگاری</label>
                    <select id={`fit-type-${i}`} className="field h-10" value={fit.fitmentType}
                      onChange={(e) => update({ fitmentType: e.target.value as FitmentRow['fitmentType'] })}>
                      <option value="DIRECT">سازگار</option>
                      <option value="WITH_MODIFICATION">سازگار با تغییر</option>
                      <option value="NOT_COMPATIBLE">ناسازگار (ثبت صریح)</option>
                    </select>
                  </div>
                  <div className="min-w-48 flex-1">
                    <label htmlFor={`fit-note-${i}`} className="label">توضیح (به مشتری نمایش داده می‌شود)</label>
                    <input id={`fit-note-${i}`} className="field h-10" value={fit.note}
                      onChange={(e) => update({ note: e.target.value })}
                      placeholder="مثال: نیازمند تعویض واشر" />
                  </div>
                </div>

                {fit.fitmentType === 'NOT_COMPATIBLE' && (
                  <p className="hint mt-1.5 text-red-700">
                    این ردیف «ناسازگاری» را صریحاً ثبت می‌کند و بر ردیف‌های عمومی‌تر اولویت دارد.
                    نبود ردیف به معنی ناسازگاری نیست؛ فقط «اطلاعات کافی نیست».
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        <p className="hint mt-3">
          ردیف بدون تیپ/موتور یعنی «همهٔ تیپ‌ها و موتورها». ردیف دقیق‌تر بر ردیف عمومی‌تر اولویت دارد.
        </p>
      </Panel>

      <Panel title="کدهای معادل و جایگزین" action={
        <Button type="button" size="sm" variant="secondary"
          onClick={() => setReferences((r) => [...r, {
            relationType: 'CROSS_REFERENCE', targetNumber: '', targetBrand: '', note: '',
          }])}>
          افزودن کد
        </Button>
      }>
        {references.length === 0 && (
          <p className="text-sm text-muted">
            کد قطعهٔ قدیمی یا کد سازندگان دیگر را اینجا ثبت کنید تا مشتری با جست‌وجوی آن کد،
            همین کالا را پیدا کند.
          </p>
        )}
        <ul className="space-y-2">
          {references.map((ref, i) => {
            const update = (patch: Partial<ReferenceRow>) =>
              setReferences((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <li key={i} className="flex flex-wrap items-end gap-2 rounded-lg border border-line p-3">
                <div className="w-48">
                  <label htmlFor={`ref-t-${i}`} className="label">نوع رابطه</label>
                  <select id={`ref-t-${i}`} className="field h-10" value={ref.relationType}
                    onChange={(e) => update({ relationType: e.target.value as ReferenceRow['relationType'] })}>
                    <option value="CROSS_REFERENCE">کد معادل سازندهٔ دیگر</option>
                    <option value="SUPERSEDES">جایگزین قطعهٔ قدیمی</option>
                    <option value="SUPERSEDED_BY">جایگزین‌شده با</option>
                    <option value="ALTERNATE">قطعهٔ معادل</option>
                  </select>
                </div>
                <div className="min-w-36 flex-1">
                  <label htmlFor={`ref-n-${i}`} className="label">کد قطعه</label>
                  <input id={`ref-n-${i}`} dir="ltr" className="field latin-id h-10" value={ref.targetNumber}
                    onChange={(e) => update({ targetNumber: e.target.value })} placeholder="GDB1330" />
                </div>
                <div className="w-40">
                  <label htmlFor={`ref-b-${i}`} className="label">سازنده</label>
                  <input id={`ref-b-${i}`} className="field h-10" value={ref.targetBrand}
                    onChange={(e) => update({ targetBrand: e.target.value })} placeholder="TRW" />
                </div>
                <button type="button" onClick={() => setReferences((r) => r.filter((_, j) => j !== i))}
                  aria-label={`حذف کد ${i + 1}`} className="mb-1 rounded-lg p-2 text-steel-400 hover:bg-red-50 hover:text-red-600">
                  <CloseIcon className="size-4" />
                </button>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title="سئو و برچسب‌ها">
        <div className="grid gap-4">
          <Field id="tags" label="برچسب‌ها" error={errors.tags} hint="با ویرگول جدا کنید. برچسب‌ها در جست‌وجو استفاده می‌شوند.">
            <input id="tags" className="field" value={values.tags} onChange={(e) => set('tags', e.target.value)}
              placeholder="لنت ترمز، پژو، 206" />
          </Field>
          <Field id="seoTitle" label="عنوان سئو" error={errors.seoTitle}>
            <input id="seoTitle" className="field" value={values.seoTitle} onChange={(e) => set('seoTitle', e.target.value)} />
          </Field>
          <Field id="seoDescription" label="توضیحات متا" error={errors.seoDescription}>
            <textarea id="seoDescription" rows={2} className="field resize-y" value={values.seoDescription}
              onChange={(e) => set('seoDescription', e.target.value)} />
          </Field>
        </div>
      </Panel>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-line bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:px-5">
        <Button type="submit" variant="accent" size="lg" disabled={busy}>
          {busy ? 'در حال ذخیره…' : productId ? 'ذخیرهٔ تغییرات' : 'ایجاد کالا'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>انصراف</Button>
        {values.sku && <LatinId className="ms-auto text-xs text-muted">{values.sku}</LatinId>}
      </div>
    </form>
  );
}

/** Loads the trims of the selected model on demand. */
function TrimSelect({
  id, modelSlug, value, onChange,
}: { id: string; modelSlug: string | null; value: string; onChange: (v: string) => void }) {
  const [trims, setTrims] = useState<{ id: string; code: string; nameFa: string }[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  if (modelSlug && loadedFor !== modelSlug) {
    setLoadedFor(modelSlug);
    void fetch(`/api/vehicles/${encodeURIComponent(modelSlug)}/trims`)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((b: { data?: { id: string; code: string; nameFa: string }[] }) => setTrims(b.data ?? []))
      .catch(() => setTrims([]));
  }

  return (
    <select id={id} className="field h-10" value={value} onChange={(e) => onChange(e.target.value)} disabled={!modelSlug}>
      <option value="">همهٔ تیپ‌ها</option>
      {trims.map((trim) => <option key={trim.id} value={trim.id}>{trim.nameFa}</option>)}
    </select>
  );
}

/** Loads the engines of the selected model on demand. */
function EngineSelect({
  id, modelSlug, value, onChange,
}: { id: string; modelSlug: string | null; value: string; onChange: (v: string) => void }) {
  const [engines, setEngines] = useState<{ id: string; code: string; nameFa: string }[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  if (modelSlug && loadedFor !== modelSlug) {
    setLoadedFor(modelSlug);
    void fetch(`/api/vehicles/${encodeURIComponent(modelSlug)}/engines`)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((b: { data?: { id: string; code: string; nameFa: string }[] }) => setEngines(b.data ?? []))
      .catch(() => setEngines([]));
  }

  return (
    <select id={id} className="field h-10" value={value} onChange={(e) => onChange(e.target.value)} disabled={!modelSlug}>
      <option value="">همهٔ تیپ‌ها</option>
      {engines.map((engine) => <option key={engine.id} value={engine.id}>{engine.code}</option>)}
    </select>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-extrabold text-steel-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({
  id, label, error, hint, required, children,
}: { id: string; label: string; error?: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
        {required && <span className="ms-1 text-red-600" aria-hidden>*</span>}
      </label>
      {children}
      {hint && !error && <p className="hint">{hint}</p>}
      {error && <p role="alert" className="error-text">{error}</p>}
    </div>
  );
}
