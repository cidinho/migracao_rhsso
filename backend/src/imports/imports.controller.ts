import {
  BadRequestException,
  Body,
  Catch,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  PayloadTooLargeException,
  Post,
  Query,
  Res,
  UploadedFile,
  UseFilters,
  UseInterceptors,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { AppConfigService } from '../config/app-config.service.js';
import { CsvFileError, TEMPLATE_CSV, formatBytes, parseCsv, type PreviewResult } from '../csv/csv-import.js';
import { ImportJobsService } from './import-jobs.service.js';
import type { JobView } from './import.types.js';
import { toReportCsv, toView } from './job-view.js';

@Catch(PayloadTooLargeException)
class UploadTooLargeFilter implements ExceptionFilter {
  constructor(@Inject(AppConfigService) private readonly config: AppConfigService) {}

  catch(_err: PayloadTooLargeException, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(413)
      .json({
        statusCode: 413,
        code: 'TOO_LARGE',
        message: `O arquivo excede o tamanho máximo de ${formatBytes(this.config.values.UPLOAD_MAX_BYTES)}.`,
      });
  }
}

const createSchema = z.object({
  fileName: z.string().max(255).default('planilha.csv'),
  groupIds: z.array(z.string().min(1)).min(1, 'Selecione ao menos um grupo.'),
  rows: z
    .array(
      z.object({
        line: z.number().int().min(1),
        uid: z.string(),
        nome: z.string(),
        email: z.string(),
      }),
    )
    .min(1, 'Nenhuma linha para importar.'),
});

@Controller('imports')
export class ImportsController {
  constructor(
    @Inject(ImportJobsService) private readonly jobs: ImportJobsService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  @Get('template.csv')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="modelo-importacao-usuarios.csv"')
  template(): string {
    return TEMPLATE_CSV;
  }

  @Post('preview')
  @HttpCode(200)
  @UseFilters(UploadTooLargeFilter)
  @UseInterceptors(FileInterceptor('file'))
  preview(@UploadedFile() file?: { originalname: string; buffer: Buffer }): PreviewResult {
    if (!file) throw new BadRequestException({ code: 'NO_FILE', message: 'Envie um arquivo CSV no campo "file".' });
    const env = this.config.values;
    try {
      return parseCsv(file.buffer, decodeFileName(file.originalname), {
        maxBytes: env.UPLOAD_MAX_BYTES,
        maxRows: env.UPLOAD_MAX_ROWS,
      });
    } catch (err) {
      if (err instanceof CsvFileError) throw new BadRequestException({ code: err.code, message: err.message });
      throw err;
    }
  }

  @Post()
  async create(@Body() body: unknown): Promise<JobView> {
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
    return toView(await this.jobs.create(parsed.data));
  }

  @Get(':id')
  status(
    @Param('id') id: string,
    @Query('since', new ParseIntPipe({ optional: true })) since?: number,
  ): JobView {
    return toView(this.jobs.get(id), since ?? 0);
  }

  @Post(':id/pause')
  @HttpCode(200)
  pause(@Param('id') id: string): JobView {
    return toView(this.jobs.pause(id), Number.MAX_SAFE_INTEGER);
  }

  @Post(':id/resume')
  @HttpCode(200)
  resume(@Param('id') id: string): JobView {
    return toView(this.jobs.resume(id), Number.MAX_SAFE_INTEGER);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string): JobView {
    return toView(this.jobs.cancel(id), Number.MAX_SAFE_INTEGER);
  }

  @Post(':id/retry-errors')
  async retryErrors(@Param('id') id: string): Promise<JobView> {
    return toView(await this.jobs.retryErrors(id));
  }

  @Get(':id/report.csv')
  report(@Param('id') id: string, @Res() res: Response): void {
    const job = this.jobs.get(id);
    const date = (job.finishedAt ?? job.createdAt).toISOString().slice(0, 19).replace(/[:T]/g, '-');
    res
      .status(200)
      .setHeader('content-type', 'text/csv; charset=utf-8')
      .setHeader('content-disposition', `attachment; filename="relatorio-importacao-${date}.csv"`)
      .send(toReportCsv(job));
  }
}

/** O multer entrega o nome do arquivo em latin1; nomes com acento precisam ser reinterpretados como UTF-8. */
function decodeFileName(name: string): string {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? name : decoded;
}
