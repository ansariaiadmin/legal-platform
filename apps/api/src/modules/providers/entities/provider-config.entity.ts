import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne } from 'typeorm';

@Entity('provider_configs')
export class ProviderConfig {
  @PrimaryGeneratedColumn('uuid')
  id!: string;
  
  @Column({
    type: 'text',
  })
  providerType!: string;
  
  @Column()
  adapterKey!: string;
  
  @Column({ type: 'jsonb', default: {} })
  config!: Record<string, unknown>;
  
  @Column({ type: 'text', nullable: true })
  encryptedSecrets!: string | null;
  
  @Column({ default: false })
  isActive!: boolean;
  
  @Column({ default: 'unknown' })
  healthStatus!: string;
  
  @Column({ type: 'timestamptz', nullable: true })
  lastHealthCheckAt!: Date | null;
  
  @Column({ type: 'uuid', nullable: true })
  fallbackProviderConfigId!: string | null;
  
  @ManyToOne(() => ProviderConfig, { nullable: true })
  fallbackProviderConfig!: ProviderConfig | null;
  
  @CreateDateColumn()
  createdAt!: Date;
  
  @UpdateDateColumn()
  updatedAt!: Date;
}
