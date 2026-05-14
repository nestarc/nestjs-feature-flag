import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FeatureFlagService } from '../services/feature-flag.service';
import { FeatureFlagWithOverrides } from '../interfaces/feature-flag.interface';
import {
  CreateFeatureFlagDto,
  RemoveOverrideDto,
  SetOverrideDto,
  UpdateFeatureFlagDto,
} from './feature-flag-admin.dto';

@Controller()
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
export class FeatureFlagAdminController {
  constructor(private readonly service: FeatureFlagService) {}

  @Post()
  create(@Body() input: CreateFeatureFlagDto): Promise<FeatureFlagWithOverrides> {
    return this.service.create(input);
  }

  @Get()
  findAll(): Promise<FeatureFlagWithOverrides[]> {
    return this.service.findAll();
  }

  @Get(':key')
  findByKey(@Param('key') key: string): Promise<FeatureFlagWithOverrides> {
    return this.service.findByKey(key);
  }

  @Patch(':key')
  update(
    @Param('key') key: string,
    @Body() input: UpdateFeatureFlagDto,
  ): Promise<FeatureFlagWithOverrides> {
    return this.service.update(key, input);
  }

  @Delete(':key')
  archive(@Param('key') key: string): Promise<FeatureFlagWithOverrides> {
    return this.service.archive(key);
  }

  @Post(':key/overrides')
  setOverride(@Param('key') key: string, @Body() input: SetOverrideDto): Promise<void> {
    return this.service.setOverride(key, input);
  }

  @Delete(':key/overrides')
  removeOverride(@Param('key') key: string, @Body() input: RemoveOverrideDto): Promise<void> {
    return this.service.removeOverride(key, input);
  }
}
