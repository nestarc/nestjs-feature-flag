import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { FeatureFlagService } from '../services/feature-flag.service';
import {
  CreateFeatureFlagInput,
  UpdateFeatureFlagInput,
  SetOverrideInput,
  FeatureFlagWithOverrides,
} from '../interfaces/feature-flag.interface';
import { RemoveOverrideInput } from '../interfaces/cache-adapter.interface';

@Controller()
export class FeatureFlagAdminController {
  constructor(private readonly service: FeatureFlagService) {}

  @Post()
  create(@Body() input: CreateFeatureFlagInput): Promise<FeatureFlagWithOverrides> {
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
    @Body() input: UpdateFeatureFlagInput,
  ): Promise<FeatureFlagWithOverrides> {
    return this.service.update(key, input);
  }

  @Delete(':key')
  archive(@Param('key') key: string): Promise<FeatureFlagWithOverrides> {
    return this.service.archive(key);
  }

  @Post(':key/overrides')
  setOverride(
    @Param('key') key: string,
    @Body() input: SetOverrideInput,
  ): Promise<void> {
    return this.service.setOverride(key, input);
  }

  @Delete(':key/overrides')
  removeOverride(
    @Param('key') key: string,
    @Body() input: RemoveOverrideInput,
  ): Promise<void> {
    return this.service.removeOverride(key, input);
  }
}
