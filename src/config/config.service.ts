import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Config } from "./validator";

@Injectable()
export class Configuration {
  constructor(private configService: ConfigService<Config, true>) {}

  get<T extends keyof Config>(key: T): Config[T] | undefined {
    return this.configService.get(key);
  }

  getOrThrow<T extends keyof Config>(key: T): Config[T] {
    return this.configService.getOrThrow(key);
  }
}
