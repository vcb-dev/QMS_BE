import { PartialType } from '@nestjs/mapped-types';
import { CreateQuoteRequestDto } from './create-quote-request.dto';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class UpdateQuoteRequestDto extends PartialType(CreateQuoteRequestDto) {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageUrls?: string[];
}
