import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import FormData from 'form-data';
import Tesseract, { createWorker, Worker } from 'tesseract.js';
import sharp from 'sharp';

export interface OcrCandidate {
  plate: string | null;
  normalized_plate?: string | null;
  raw_text?: string | null;
  confidence: number | null;
}

export interface VisionResponse {
  detected: boolean;
  plate: string | null;
  normalized_plate?: string | null;
  raw_text?: string | null;
  confidence: number | null;
  detector_confidence?: number | null;
  low_confidence: boolean;
  candidates: OcrCandidate[];
  bbox?: { x: number; y: number; width: number; height: number } | null;
  latency_ms?: number;
  timings?: {
    preprocess_ms?: number;
    ocr_ms?: number;
    total_ms?: number;
  };
}

/**
 * Palabras de parada que no deben confundirse con matrículas vehiculares.
 */
const STOP_WORDS = new Set([
  'GARAJE', 'GARAGE', 'INGRESO', 'INGRESOS', 'SALIDA', 'SALIDAS', 'ENTRADA', 'ENTRADAS',
  'DENTRO', 'AFUERA', 'RAPIDO', 'TICKET', 'ESTACIONAMIENTO', 'TOTAL', 'PRECIO', 'FECHA',
  'HORA', 'PAGO', 'PAGOS', 'CAJA', 'TARJETA', 'VEHICULO', 'BOLETA', 'FACTURA', 'LIMA',
  'PERU', 'ESTADO', 'TIEMPO', 'CLIENTE',
]);

/**
 * Reglas de formatos de matrícula peruanas e internacionales comunes.
 */
interface PlateRule {
  name: string;
  pattern: RegExp;
  cleanTest: (s: string) => boolean;
  format: (s: string) => string;
}

const PLATE_RULES: PlateRule[] = [
  // 1. Auto particular / provincial (6 car): ABC-123, A1B-123, A1B-234, A12-345
  {
    name: 'Auto particular / provincial',
    pattern: /\b([A-Z][A-Z0-9]{2})[- ]?(\d{3})\b/i,
    cleanTest: (s) => /^[A-Z][A-Z0-9]{2}\d{3}$/.test(s),
    format: (s) => `${s.slice(0, 3)}-${s.slice(3)}`,
  },
  // 2. Moto / Mototaxi (6 car): 1234-5A o 1234-AB
  {
    name: 'Moto / Mototaxi',
    pattern: /\b(\d{4})[- ]?([A-Z0-9]{2})\b/i,
    cleanTest: (s) => /^\d{4}[A-Z0-9]{2}$/.test(s),
    format: (s) => `${s.slice(0, 4)}-${s.slice(4)}`,
  },
  // 3. Moto / Auto antiguo (6 car): AB-1234 o A1-2345
  {
    name: 'Moto / Auto antiguo',
    pattern: /\b([A-Z0-9]{2})[- ]?(\d{4})\b/i,
    cleanTest: (s) => /^[A-Z0-9]{2}\d{4}$/.test(s),
    format: (s) => `${s.slice(0, 2)}-${s.slice(2)}`,
  },
  // 4. Motocicleta 7 car.: AB-12345
  {
    name: 'Motocicleta 7 car.',
    pattern: /\b([A-Z]{2})[- ]?(\d{5})\b/i,
    cleanTest: (s) => /^[A-Z]{2}\d{5}$/.test(s),
    format: (s) => `${s.slice(0, 2)}-${s.slice(2)}`,
  },
  // 5. Motocicleta antigua (5 car): A-1234
  {
    name: 'Motocicleta antigua',
    pattern: /\b([A-Z])[- ]?(\d{4,5})\b/i,
    cleanTest: (s) => /^[A-Z]\d{4,5}$/.test(s),
    format: (s) => `${s.slice(0, 1)}-${s.slice(1)}`,
  },
  // 6. Vehículos oficiales / Emergencia: PNP-123, EGA-123, CGBVP-123, CD-1234
  {
    name: 'Vehículo oficial / emergencia',
    pattern: /\b(PNP|EGA|CGBVP|CD|CC|MI|EP|PR)[- ]?(\d{3,4})\b/i,
    cleanTest: (s) => /^(?:PNP|EGA|CGBVP|CD|CC|MI|EP|PR)\d{3,4}$/.test(s),
    format: (s) => {
      const match = s.match(/^(PNP|EGA|CGBVP|CD|CC|MI|EP|PR)(\d+)$/);
      return match ? `${match[1]}-${match[2]}` : s;
    },
  },
  // 7. Placa Internacional / Mercosur / Genérica (5 a 8 car alfanuméricos)
  {
    name: 'Internacional / Genérica',
    pattern: /\b([A-Z0-9]{5,8})\b/i,
    cleanTest: (s) => /^[A-Z0-9]{5,8}$/.test(s) && /[A-Z]/.test(s) && /\d/.test(s),
    format: (s) => {
      if (/^[A-Z]{3}\d{3}$/.test(s)) return `${s.slice(0, 3)}-${s.slice(3)}`;
      if (/^[A-Z][A-Z0-9]{2}\d{3}$/.test(s)) return `${s.slice(0, 3)}-${s.slice(3)}`;
      if (/^\d{4}[A-Z]{2}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4)}`;
      if (/^[A-Z]{2}\d{5}$/.test(s)) return `${s.slice(0, 2)}-${s.slice(2)}`;
      return s;
    },
  },
];

/**
 * Normaliza caracteres ambiguos en texto OCR de matrículas:
 * En matrículas vehiculares, 'l' minúscula o '|' o '!' representan invariablemente el dígito '1'.
 */
function cleanOcrText(raw: string): string {
  return raw
    .replace(/[l|!]/g, '1')
    .replace(/[\s_]/g, '')
    .toUpperCase();
}

function normalizePlateKey(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

@Injectable()
export class VisionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VisionService.name);
  private worker: Worker | null = null;
  private isReady = false;
  private isInitializing = false;

  constructor(private configService: ConfigService) {}

  /**
   * Inicialización del Worker Tesseract persistente (singleton en arranque) y warm-up.
   */
  async onModuleInit() {
    await this.initOcrEngine();
  }

  async onModuleDestroy() {
    if (this.worker) {
      try {
        await this.worker.terminate();
        this.logger.log('Worker Tesseract OCR finalizado correctamente.');
      } catch (e: any) {
        this.logger.warn(`Error al terminar worker: ${e.message}`);
      }
    }
  }

  get isOcrReady(): boolean {
    return this.isReady;
  }

  private async initOcrEngine() {
    if (this.isReady || this.isInitializing) return;
    this.isInitializing = true;
    const startInit = Date.now();

    try {
      this.logger.log('Iniciando motor persistente Tesseract OCR...');
      this.worker = await createWorker('eng');
      await this.worker.setParameters({
        tessedit_pageseg_mode: '6' as any,
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-',
      });

      // Warm-up con imagen de prueba sintética
      const dummySvg = Buffer.from(`
        <svg width="200" height="70" xmlns="http://www.w3.org/2000/svg">
          <rect width="100%" height="100%" fill="white"/>
          <text x="100" y="45" font-family="sans-serif" font-size="30" text-anchor="middle" fill="black">ABC-123</text>
        </svg>
      `);
      const warmupPng = await sharp(dummySvg).png().toBuffer();
      await this.worker.recognize(warmupPng);

      this.isReady = true;
      this.logger.log(`Motor OCR persistente inicializado y listo en ${Date.now() - startInit}ms (warm-up OK).`);
    } catch (err: any) {
      this.logger.error(`Error al inicializar worker OCR persistente: ${err.message}`);
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Procesa una imagen o recorte de placa mediante preprocesamiento Sharp y OCR localizado.
   */
  async readPlate(
    fileBuffer: Buffer,
    filename = 'plate.jpg',
    bboxJson?: string,
  ): Promise<VisionResponse> {
    const startTime = Date.now();
    const token = this.configService.get<string>('PLATE_RECOGNIZER_TOKEN');

    let parsedBbox: { x: number; y: number; width: number; height: number } | null = null;
    if (bboxJson) {
      try {
        parsedBbox = JSON.parse(bboxJson);
      } catch {
        // Ignorar error de parsing
      }
    }

    // 1. Servicio externo si token configurado
    if (token && token.trim().length > 5) {
      try {
        this.logger.log('Consultando Plate Recognizer API...');
        const formData = new FormData();
        formData.append('upload', fileBuffer, { filename });

        const response = await axios.post('https://api.platerecognizer.com/v1/plate-reader/', formData, {
          headers: {
            Authorization: `Token ${token.trim()}`,
            ...formData.getHeaders(),
          },
          timeout: 5000,
        });

        const results = response.data?.results;
        if (results && results.length > 0) {
          const bestResult = results[0];
          const rawPlate = (bestResult.plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
          const score = typeof bestResult.score === 'number' ? bestResult.score : 0.90;
          const formattedPlate = this.formatPlateText(rawPlate);

          const candidates: OcrCandidate[] = (bestResult.candidates || []).map((c: any) => ({
            plate: this.formatPlateText(c.plate?.toUpperCase().replace(/[^A-Z0-9]/g, '')),
            normalized_plate: normalizePlateKey(c.plate || ''),
            raw_text: c.plate,
            confidence: typeof c.score === 'number' ? c.score : score,
          }));

          const totalMs = Date.now() - startTime;
          return {
            detected: true,
            plate: formattedPlate,
            normalized_plate: normalizePlateKey(formattedPlate),
            raw_text: rawPlate,
            confidence: score,
            detector_confidence: 0.95,
            low_confidence: score < 0.6,
            candidates: candidates.length > 0 ? candidates : [{
              plate: formattedPlate,
              normalized_plate: normalizePlateKey(formattedPlate),
              raw_text: rawPlate,
              confidence: score,
            }],
            bbox: parsedBbox || (bestResult.box ? {
              x: bestResult.box.xmin,
              y: bestResult.box.ymin,
              width: bestResult.box.xmax - bestResult.box.xmin,
              height: bestResult.box.ymax - bestResult.box.ymin,
            } : null),
            latency_ms: totalMs,
            timings: { total_ms: totalMs },
          };
        }
      } catch (error: any) {
        this.logger.warn(`Plate Recognizer API no disponible (${error.message}). Continuando con motor local...`);
      }
    }

    // 2. Motor OCR localizado persistente local con preprocesamiento óptico adaptativo
    const result = await this.processImageWithTargetedOcr(fileBuffer);
    if (parsedBbox) {
      result.bbox = parsedBbox;
    }
    result.latency_ms = Date.now() - startTime;
    return result;
  }

  /**
   * Procesa múltiples fotogramas para consenso temporal en el servidor.
   */
  async readFrames(frameBuffers: Buffer[]): Promise<VisionResponse> {
    const startTime = Date.now();
    this.logger.log(`Procesando lote de ${frameBuffers.length} frames...`);

    const results: VisionResponse[] = [];
    for (const buf of frameBuffers) {
      results.push(await this.processImageWithTargetedOcr(buf));
    }

    const plateScores = new Map<string, { totalScore: number; count: number; raw: string; normalized: string }>();

    for (const res of results) {
      if (res.detected && res.plate) {
        const key = res.plate;
        const norm = res.normalized_plate || normalizePlateKey(key);
        const current = plateScores.get(key) || { totalScore: 0, count: 0, raw: res.raw_text || res.plate, normalized: norm };
        current.totalScore += res.confidence || 0.75;
        current.count += 1;
        plateScores.set(key, current);
      }
      for (const cand of res.candidates) {
        if (cand.plate) {
          const key = cand.plate;
          const norm = cand.normalized_plate || normalizePlateKey(key);
          const current = plateScores.get(key) || { totalScore: 0, count: 0, raw: cand.raw_text || cand.plate, normalized: norm };
          current.totalScore += (cand.confidence || 0.7) * 0.8;
          current.count += 1;
          plateScores.set(key, current);
        }
      }
    }

    if (plateScores.size > 0) {
      const sorted = Array.from(plateScores.entries()).sort(
        (a, b) => b[1].totalScore + b[1].count * 0.2 - (a[1].totalScore + a[1].count * 0.2),
      );
      const [bestPlate, bestData] = sorted[0];
      const avgConfidence = Math.min(0.98, bestData.totalScore / bestData.count + (bestData.count > 1 ? 0.08 : 0));

      const candidates: OcrCandidate[] = sorted.map(([plate, data]) => ({
        plate,
        normalized_plate: data.normalized,
        raw_text: data.raw,
        confidence: Math.min(0.98, data.totalScore / data.count),
      }));

      const totalMs = Date.now() - startTime;
      return {
        detected: true,
        plate: bestPlate,
        normalized_plate: bestData.normalized,
        raw_text: bestData.raw,
        confidence: avgConfidence,
        detector_confidence: 0.90,
        low_confidence: avgConfidence < 0.6,
        candidates,
        latency_ms: totalMs,
        timings: { total_ms: totalMs },
      };
    }

    const totalMs = Date.now() - startTime;
    return {
      detected: false,
      plate: null,
      confidence: null,
      low_confidence: false,
      candidates: [],
      latency_ms: totalMs,
      timings: { total_ms: totalMs },
    };
  }

  /**
   * Preprocesa el recorte de la placa generando variantes ópticas adaptativas.
   */
  private async generatePreprocessedVariants(imageBuffer: Buffer): Promise<{ variants: Buffer[]; preprocessMs: number }> {
    const tStart = Date.now();
    const variants: Buffer[] = [];

    try {
      const metadata = await sharp(imageBuffer).metadata();
      const width = metadata.width || 400;
      const height = metadata.height || 150;
      const targetWidth = Math.max(550, Math.min(900, Math.round(width * 1.4)));

      // 1. Escala óptima (~700px) + Escala de grises + Normalización
      variants.push(
        await sharp(imageBuffer)
          .resize({ width: targetWidth, withoutEnlargement: false })
          .grayscale()
          .normalize()
          .toBuffer(),
      );

      // 2. Variante con recorte de bordes exteriores (5-7%) para eliminar interferencia de marcos
      if (width > 60 && height > 30) {
        const padX = Math.round(width * 0.06);
        const padY = Math.round(height * 0.08);
        variants.push(
          await sharp(imageBuffer)
            .extract({ left: padX, top: padY, width: width - padX * 2, height: height - padY * 2 })
            .resize({ width: targetWidth, withoutEnlargement: false })
            .grayscale()
            .normalize()
            .toBuffer(),
        );
      }

      // 3. Alto contraste threshold adaptativo (para sombras o fondos oscuros)
      variants.push(
        await sharp(imageBuffer)
          .resize({ width: targetWidth, withoutEnlargement: false })
          .grayscale()
          .threshold(128)
          .toBuffer(),
      );
    } catch (e: any) {
      this.logger.warn(`Error en preprocesamiento Sharp: ${e.message}. Usando imagen original.`);
      variants.push(imageBuffer);
    }

    return { variants, preprocessMs: Date.now() - tStart };
  }

  /**
   * Ejecuta OCR utilizando el worker persistente pre-inicializado.
   */
  private async processImageWithTargetedOcr(imageBuffer: Buffer): Promise<VisionResponse> {
    const tStart = Date.now();

    // Asegurar que el worker esté inicializado
    if (!this.worker || !this.isReady) {
      await this.initOcrEngine();
    }

    const { variants, preprocessMs } = await this.generatePreprocessedVariants(imageBuffer);
    const candidateMap = new Map<string, { plate: string; raw_text: string; confidence: number; weight: number }>();
    let ocrTotalMs = 0;

    for (let i = 0; i < variants.length; i++) {
      const variantBuffer = variants[i];
      const tOcrStart = Date.now();

      try {
        let resultData: any;
        if (this.worker) {
          const res = await this.worker.recognize(variantBuffer);
          resultData = res.data;
        } else {
          const res = await Tesseract.recognize(variantBuffer, 'eng', {
            tessedit_pageseg_mode: '6',
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-',
          } as any);
          resultData = res.data;
        }

        ocrTotalMs += (Date.now() - tOcrStart);

        const rawText = (resultData.text || '').trim();
        const cleanedText = cleanOcrText(rawText);

        // Extraer candidatos del texto completo limpio
        this.extractCandidatesFromText(cleanedText, rawText, candidateMap, 1.0 - i * 0.1);

        const pageData = resultData as unknown as { words?: Array<{ text: string; confidence: number }> };
        const words = pageData.words || [];

        for (const w of words) {
          const wRaw = (w.text || '').trim();
          const wClean = cleanOcrText(wRaw);
          if (wClean.length >= 4 && wClean.length <= 10) {
            this.extractCandidatesFromWord(wClean, wRaw, w.confidence || 75, candidateMap, 1.0 - i * 0.1);
          }
        }

        // Si ya obtuvimos un candidato con alta confianza (>= 0.88), no es necesario correr más variantes
        const topCandidates = Array.from(candidateMap.values()).filter((c) => c.confidence >= 0.88);
        if (topCandidates.length > 0) break;
      } catch (err: any) {
        this.logger.warn(`Error en pasada OCR variante ${i}: ${err.message}`);
      }
    }

    const allCandidates = Array.from(candidateMap.values()).filter((c) => {
      const cleanRaw = (c.raw_text || '').toUpperCase().replace(/[^A-Z]/g, '');
      if (STOP_WORDS.has(cleanRaw)) return false;
      return true;
    });

    const totalMs = Date.now() - tStart;

    if (allCandidates.length > 0) {
      allCandidates.sort((a, b) => b.confidence * b.weight - a.confidence * a.weight);
      const winner = allCandidates[0];
      const normPlate = normalizePlateKey(winner.plate);

      this.logger.log(
        `[ANPR] OCR RAW: "${winner.raw_text}" | NORMALIZED: "${normPlate}" | CONFIDENCE: ${Math.round(winner.confidence * 100)}% | Preprocess: ${preprocessMs}ms | OCR: ${ocrTotalMs}ms | Total: ${totalMs}ms`,
      );

      return {
        detected: true,
        plate: winner.plate,
        normalized_plate: normPlate,
        raw_text: winner.raw_text,
        confidence: Math.min(0.98, winner.confidence),
        detector_confidence: 0.92,
        low_confidence: winner.confidence < 0.6,
        candidates: allCandidates.map((c) => ({
          plate: c.plate,
          normalized_plate: normalizePlateKey(c.plate),
          raw_text: c.raw_text,
          confidence: Math.min(0.98, c.confidence),
        })),
        latency_ms: totalMs,
        timings: {
          preprocess_ms: preprocessMs,
          ocr_ms: ocrTotalMs,
          total_ms: totalMs,
        },
      };
    }

    return {
      detected: false,
      plate: null,
      confidence: null,
      detector_confidence: null,
      low_confidence: false,
      candidates: [],
      latency_ms: totalMs,
      timings: {
        preprocess_ms: preprocessMs,
        ocr_ms: ocrTotalMs,
        total_ms: totalMs,
      },
    };
  }

  /**
   * Extrae candidatos alfanuméricos desde un texto detectado.
   */
  private extractCandidatesFromText(
    cleanedText: string,
    rawText: string,
    candidateMap: Map<string, { plate: string; raw_text: string; confidence: number; weight: number }>,
    passWeight: number,
  ): void {
    const cleanLines = cleanedText
      .split('\n')
      .map((l) => l.trim().toUpperCase())
      .filter(Boolean);

    for (const line of cleanLines) {
      for (const rule of PLATE_RULES) {
        const matches = line.matchAll(new RegExp(rule.pattern, 'gi'));
        for (const m of matches) {
          const raw = m[0].toUpperCase().replace(/[\s._-]/g, '');
          if (rule.cleanTest(raw)) {
            const formatted = rule.format(raw);
            const existing = candidateMap.get(formatted);
            const currentWeight = (existing?.weight || 0) + passWeight;
            candidateMap.set(formatted, {
              plate: formatted,
              raw_text: rawText || m[0],
              confidence: Math.min(0.96, 0.88 + Math.min(0.08, (currentWeight - 1) * 0.04)),
              weight: currentWeight,
            });
          }
        }
      }
    }
  }

  /**
   * Evalúa una palabra individual.
   */
  private extractCandidatesFromWord(
    cleanedWord: string,
    rawWord: string,
    wordConfidence: number,
    candidateMap: Map<string, { plate: string; raw_text: string; confidence: number; weight: number }>,
    passWeight: number,
  ): void {
    const clean = cleanedWord.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.length < 4 || clean.length > 10) return;
    const cleanLetters = clean.replace(/[^A-Z]/g, '');
    if (STOP_WORDS.has(cleanLetters)) return;

    for (const rule of PLATE_RULES) {
      if (rule.cleanTest(clean)) {
        const formatted = rule.format(clean);
        const baseConf = Math.max(0.70, Math.min(0.96, wordConfidence / 100));
        const existing = candidateMap.get(formatted);
        const currentWeight = (existing?.weight || 0) + passWeight;
        candidateMap.set(formatted, {
          plate: formatted,
          raw_text: rawWord,
          confidence: Math.min(0.96, baseConf + Math.min(0.08, (currentWeight - 1) * 0.04)),
          weight: currentWeight,
        });
        return;
      }
    }
  }

  /**
   * Formatea un texto de placa según las reglas de negocio.
   */
  private formatPlateText(cleanPlate: string): string {
    if (!cleanPlate) return cleanPlate;
    const clean = cleanPlate.toUpperCase().replace(/[^A-Z0-9]/g, '');

    for (const rule of PLATE_RULES) {
      if (rule.cleanTest(clean)) {
        return rule.format(clean);
      }
    }
    return clean;
  }
}
