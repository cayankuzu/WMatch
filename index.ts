import { registerRootComponent } from 'expo';

import App from './App';
import { initializeTelemetry } from './src/services/telemetry';

initializeTelemetry();
registerRootComponent(App);
