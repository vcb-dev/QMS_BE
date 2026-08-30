import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateDmBridgeDto {
  @IsBoolean()
  isEnabled!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
