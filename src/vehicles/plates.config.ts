/*
  Configuración central de formatos de placa (FUENTE ÚNICA DE VERDAD).

  Aquí viven los formatos peruanos comunes aceptados por el sistema. Para
  ampliar o ajustar formatos SOLO se edita PLATE_FORMATS; ninguna otra parte
  del backend hardcodea patrones.

  Reglas de negocio implementadas con esta config:
  - La placa se normaliza (mayúsculas, sin espacios/guiones/puntos) antes de
    comparar o guardar la clave canónica `plateNormalized`.
  - El texto original tipeado/leído por OCR se conserva en `plateRaw`/`plate`.
  - Una placa que no coincide con NINGÚN formato peruano NO se rechaza:
    `matchesPeruvianFormat` devuelve false y las capas superiores muestran
    solo una advertencia (placa extranjera u otro formato), permitiendo seguir.
*/

/** Largo mínimo/máximo de la placa YA normalizada (sin espacios ni guiones). */
export const PLATE_MIN_LENGTH = 4;
export const PLATE_MAX_LENGTH = 15;

export interface PlateFormat {
  /** Nombre descriptivo del formato (para mensajes/UI). */
  name: string;
  /** Ejemplo ilustrativo. */
  example: string;
  /** Regex sobre la placa NORMALIZADA (mayúsculas, sin separadores). */
  pattern: RegExp;
}

/**
 * Formatos peruanos comunes:
 * - Auto particular: 3 letras + 3 dígitos (ABC-123 / ABC123).
 * - Motocicleta (formato actual): 2 letras + 5 dígitos (AB-12345).
 * - Motocicleta (formato antiguo): 1 letra + 5 dígitos (A-12345).
 */
export const PLATE_FORMATS: PlateFormat[] = [
  {
    name: 'Auto particular / provincial',
    example: 'ABC-123',
    pattern: /^[A-Z][A-Z0-9]{2}\d{3}$/,
  },
  { name: 'Auto antiguo', example: 'AB-1234', pattern: /^[A-Z]{2}\d{4}$/ },
  {
    name: 'Moto / Mototaxi',
    example: '1234-5A',
    pattern: /^\d{4}[A-Z0-9]{2}$/,
  },
  {
    name: 'Moto / Trimóvil',
    example: 'AB-1234',
    pattern: /^[A-Z0-9]{2}\d{4}$/,
  },
  {
    name: 'Motocicleta (7 car.)',
    example: 'AB-12345',
    pattern: /^[A-Z]{2}\d{5}$/,
  },
  {
    name: 'Motocicleta (antiguo)',
    example: 'A-12345',
    pattern: /^[A-Z]\d{4,5}$/,
  },
  {
    name: 'Vehículo oficial / emergencia',
    example: 'PNP-123',
    pattern: /^(?:PNP|EGA|CGBVP|CD|CC|MI|EP|PR)\d{3,4}$/,
  },
];

/**
 * Normaliza una placa para compararla/guardarla como clave canónica:
 * mayúsculas, sin espacios, guiones, puntos ni subguiones.
 */
export function normalizePlate(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[\s._-]/g, '');
}

/** true si la placa normalizada coincide con algún formato peruano configurado. */
export function matchesPeruvianFormat(normalizedPlate: string): boolean {
  return PLATE_FORMATS.some((format) => format.pattern.test(normalizedPlate));
}

/** Valida el largo de la placa normalizada (límite duro independiente del país). */
export function isValidNormalizedLength(normalizedPlate: string): boolean {
  return (
    normalizedPlate.length >= PLATE_MIN_LENGTH &&
    normalizedPlate.length <= PLATE_MAX_LENGTH
  );
}
