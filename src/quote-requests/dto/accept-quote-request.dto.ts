import { IsNumber, IsOptional } from 'class-validator';

export class AcceptQuoteRequestDto {
  @IsOptional()
  @IsNumber()
  version?: number;
}
