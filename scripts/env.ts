/** Loads .env.local then .env for CLI scripts (Next loads these itself at runtime). */
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });
