import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path: string) {
  return readFileSync(path, 'utf8');
}

function readTogether(...paths: string[]) {
  return paths.map(read).join('\n');
}

function collectSourceFiles(path: string): string[] {
  const stats = statSync(path);

  if (stats.isFile()) {
    return /\.(ts|tsx)$/.test(path) ? [path] : [];
  }

  return readdirSync(path).flatMap((entry) => collectSourceFiles(join(path, entry)));
}

function readEdgeSource() {
  const edgeRoot = 'supabase/functions/make-server-d962235e';
  const preferredOrder = [
    'runtime.ts',
    'sharedMiddleware.ts',
    'domains/storage.ts',
    'domains/system.ts',
    'domains/tmdb.ts',
    'domains/auth.ts',
    'domains/profileDiscovery.ts',
    'domains/swipe.ts',
    'domains/match.ts',
    'domains/chat.ts',
    'domains/moderation.ts',
    'domains/notification.ts',
    'accountDeletion.ts',
    'httpSecurity.ts',
    'originHmac.ts',
    'routeRegistry.ts',
    'index.ts',
  ].map((path) => join(edgeRoot, path));
  const remainingFiles = collectSourceFiles(edgeRoot)
    .filter((path) => !preferredOrder.includes(path) && !path.endsWith('_test.ts'))
    .sort();

  return [...preferredOrder, ...remainingFiles].map(read).join('\n');
}

const EXPO_CLI = join('node_modules', 'expo', 'bin', 'cli');

describe('production guardrails', () => {
  it('keeps all six requested primary destinations, including Compatibility', () => {
    const navSource = read('src/app/components/BottomNav.tsx');
    const itemIds = [...navSource.matchAll(/\{ id: '([^']+)', labelKey:/g)].map((match) => match[1]);

    expect(itemIds).toEqual(['watch', 'match', 'compatibility', 'likes', 'chat', 'profile']);
  });

  it('keeps private local credentials out of EAS build uploads', () => {
    const easIgnore = read('.easignore');
    const secretCheck = read('scripts/check-no-private-secrets.mjs');

    expect(easIgnore).toContain('\n.env\n');
    expect(easIgnore).toContain('\n.env.*\n');
    expect(easIgnore).not.toContain('\n!.env\n');
    expect(easIgnore).toContain('\n.secrets/\n');
    expect(easIgnore).toContain('\ncredentials.json\n');
    expect(secretCheck).toContain("fail('.easignore must not re-include a private environment file')");
  });

  it('requires Supabase public config from the build environment', () => {
    const source = read('utils/supabase/info.tsx');

    expect(source).toContain('requirePublicEnv');
    expect(source).not.toMatch(/EXPO_PUBLIC_SUPABASE_PROJECT_ID\s*\?\?/);
    expect(source).not.toMatch(/EXPO_PUBLIC_SUPABASE_ANON_KEY\s*\?\?/);
    expect(source).not.toContain('eyJhbGci');
  });

  it('uses PKCE and rejects raw session tokens in auth deep links', () => {
    const clientSource = read('utils/supabase/client.ts');
    const authSource = readTogether(
      'src/context/AuthContext.tsx',
      'src/context/auth/authSupport.ts',
      'src/context/auth/authDeepLink.ts',
    );

    expect(clientSource).toContain("flowType: 'pkce'");
    expect(authSource).toContain('exchangeCodeForSession');
    expect(authSource).not.toContain('supabase.auth.setSession');
    expect(authSource).not.toContain('TRUSTED_CUSTOM_AUTH_SCHEMES');
    expect(authSource).toContain('getTrustedAuthDeepLinkKind');
    expect(authSource).toContain('validateAuthFlowState');
    expect(authSource).toContain("beginAuthFlow('signup')");
    expect(authSource).toContain("beginAuthFlow('recovery')");
    expect(authSource).not.toContain('exp+wmatch');
  });

  it('does not trust spoofable proxy chains or expose native APIs through wildcard CORS', () => {
    const edgeSource = readEdgeSource();
    const clientSource = read('utils/supabase/client.ts');

    expect(edgeSource).not.toContain('c.req.header("x-forwarded-for")');
    expect(edgeSource).not.toContain('origin: "*"');
    expect(edgeSource).toContain('TRUSTED_CLIENT_IP_HEADER');
    expect(edgeSource).toContain('getRequestRateLimitIdentity');
    expect(clientSource).toContain("'X-WMatch-Install-Id'");
  });

  it('keeps discovery invalidation event driven instead of interval polling', () => {
    const source = read('src/app/hooks/useDiscoveryData.ts');

    expect(source).not.toContain('POLL_INTERVAL_MS');
    expect(source).not.toContain('setInterval');
  });

  it('keeps cold-start data on cache-first paths and startup work bounded', () => {
    const authSource = read('src/context/AuthContext.tsx');
    const tmdbSource = read('src/services/tmdb.ts');
    const appSource = read('src/app/App.tsx');
    const liveNowSource = read('src/app/hooks/useLiveNowUsers.ts');
    const userEventBusSource = read('src/services/userEventBus.ts');
    const rootSource = read('App.tsx');
    const metroSource = read('metro.config.js');
    const telemetrySource = read('src/services/telemetry.ts');

    expect(authSource.indexOf('const cachedUser = await cachedProfilePromise'))
      .toBeLessThan(authSource.indexOf('const profileResult = await profileRequest'));
    expect(authSource).toContain('setLoading(false)');
    expect(tmdbSource).toContain('revalidateTMDB(path)');
    expect(tmdbSource).toContain('return persistentCache.value as T');
    expect(liveNowSource).toContain('FALLBACK_POLL_INTERVAL_MS = 30_000');
    expect(liveNowSource).toContain("subscribeToUserEvent(userId, 'discovery_changed'");
    expect(userEventBusSource).toContain("channel.on('broadcast', { event }");
    expect(appSource).toContain('scheduleIdleWork');
    expect(appSource).toContain('globalThis.requestIdleCallback');
    expect(appSource).not.toContain('InteractionManager');
    expect(rootSource).toContain('ExpoSplashScreen.preventAutoHideAsync()');
    expect(rootSource).toContain('ExpoSplashScreen.hideAsync()');
    expect(metroSource).toContain('inlineRequires: true');
    expect(telemetrySource).toContain('markStartupMilestone');
    expect(appSource).toContain("markStartupMilestone('session_ready'");
  });

  it('uses an ADB-reversed localhost Metro route for USB debug sessions', () => {
    const packageSource = read('package.json');
    const debugScriptSource = read('start-dev-client.ps1');

    expect(packageSource).toContain('start-dev-client.ps1');
    expect(packageSource).toContain('"dev:lan"');
    expect(debugScriptSource).toContain('$metroPort = 18082');
    expect(debugScriptSource).toContain('reverse "tcp:$metroPort" "tcp:$metroPort"');
    expect(debugScriptSource).toContain("$env:EXPO_NO_DOTENV = '1'");
    expect(debugScriptSource).toContain('EXPO_PUBLIC_');
    expect(debugScriptSource).toContain("$publicEnvironment['SUPABASE_PROJECT_REF']");
    expect(debugScriptSource).toContain("$publicEnvironment['SUPABASE_ANON_KEY']");
    expect(debugScriptSource).not.toContain("Env:SUPABASE_SECRET_KEY");
    expect(debugScriptSource).not.toContain("Env:SUPABASE_ACCESS_TOKEN");
    expect(debugScriptSource).toContain('--host localhost');
    expect(debugScriptSource).toContain('http%3A%2F%2F127.0.0.1%3A$metroPort');
    expect(debugScriptSource).toContain('android.intent.action.VIEW');
    expect(debugScriptSource).not.toContain('--android');
  });

  it('keeps recent tabs mounted in normal layout flow with a strict memory bound', () => {
    const appSource = read('src/app/App.tsx');
    const navSource = read('src/app/components/BottomNav.tsx');
    const sceneSource = read('src/app/components/ui/TabScene.tsx');
    const runtimeSource = read('src/services/runtimeProfile.ts');

    expect(appSource).toContain('const renderTab = (tab: AppTab) =>');
    expect(appSource).toContain('<View style={styles.content}>');
    expect(appSource).toContain('renderedResidentTabs.map((tab) =>');
    expect(appSource).toContain('MAX_RESIDENT_TABS = getResidentTabLimit()');
    expect(runtimeSource).toContain("runtimeProfile.tier === 'constrained' ? 2");
    expect(appSource).toContain('TAB_RENDER_ORDER.filter((tab) => residentTabs.includes(tab))');
    expect(appSource).toContain('<TabScene');
    expect(sceneSource).toContain('collapsable={false}');
    expect(sceneSource).toContain("pointerEvents={active ? 'auto' : 'none'}");
    expect(appSource).not.toContain('screenLayer');
    expect(appSource).not.toContain("position: 'absolute'");
    expect(appSource).not.toContain('zIndex: 0');
    expect(navSource).toContain("width: '100%'");
    expect(navSource).not.toContain("position: 'absolute'");
    expect(navSource).not.toContain('zIndex:');
    expect(navSource).not.toContain('elevation:');
    expect(navSource).toContain('pointerEvents="box-none"');
  });

  it('uses a targeted private broadcast instead of Postgres Changes for discovery invalidation', () => {
    const source = read('src/app/hooks/useDiscoveryData.ts');
    const busSource = read('src/services/userEventBus.ts');

    expect(source).toContain("subscribeToUserEvent(");
    expect(source).toContain("'discovery_changed'");
    expect(busSource).toContain('`user-events:${userId}`');
    expect(busSource).toContain("channel.on('broadcast', { event }");
    expect(source).not.toContain("'postgres_changes'");
  });

  it('does not use wildcard selects in the Edge API', () => {
    const source = readEdgeSource();

    expect(source).not.toContain('.select("*")');
    expect(source).not.toMatch(/\.select\(\s*\)/);
    expect(source).toContain('PUBLIC_PROFILE_SELECT');
    expect(source).toContain('SERVER_PROFILE_SELECT');
  });

  it('keeps exact location in the private profile boundary', () => {
    const edgeSource = readEdgeSource();
    const migrationSource = read('supabase/migrations/20260714120000_profile_private_location_boundary.sql');

    expect(migrationSource).toContain('CREATE TABLE IF NOT EXISTS public.profiles_private');
    expect(migrationSource).toContain('UPDATE public.profiles');
    expect(migrationSource).toContain('latitude = NULL');
    expect(migrationSource).toContain('REVOKE ALL ON TABLE public.profiles_private');
    expect(migrationSource).toContain('ALTER PUBLICATION supabase_realtime DROP TABLE public.profiles_private');
    expect(edgeSource).toContain('loadPrivateProfileLocationMap');
    expect(edgeSource).toContain('upsertPrivateProfileLocation');
  });

  it('keeps critical client table mutations revoked by migration', () => {
    const source = read('supabase/migrations/20260714103000_public_api_security_and_storage_hardening.sql');

    expect(source).toContain('REVOKE INSERT, UPDATE, DELETE ON TABLE');

    for (const table of [
      'public.profiles',
      'public.user_movies',
      'public.likes',
      'public.matches',
      'public.messages',
      'public.discovery_preferences',
      'public.swipe_quotas',
    ]) {
      expect(source).toContain(table);
    }

    expect(source).toContain('CREATE POLICY "No direct message writes"');
    expect(source).toContain('CREATE POLICY "No direct like writes"');
    expect(source).toContain('CREATE POLICY "No direct profile updates"');
  });

  it('uses deterministic keyset pagination for the full compatibility candidate set', () => {
    const edgeSource = readEdgeSource();
    const migrationSource = read('supabase/migrations/20260819090000_discovery_correctness_read_models.sql');
    const screenSource = read('src/app/components/CompatibilityScreen.tsx');

    expect(edgeSource).toMatch(/supabase\.rpc\(\s*"get_compatibility_candidate_page"/);
    expect(edgeSource).not.toContain('loadCompatibilityCandidatePageFallback');
    expect(edgeSource).toContain('p_cursor_score: cursor?.score');
    expect(edgeSource).not.toContain('p_cursor_overlap');
    expect(edgeSource).toContain('.limit(MAX_RELATIONSHIP_ROWS)');
    expect(edgeSource).toContain('decodeCompatibilityCursor');
    expect(edgeSource).toContain('encodeCompatibilityCursor');
    expect(edgeSource).not.toContain('MAX_COMPATIBILITY_CANDIDATE_ROWS');
    expect(migrationSource).toContain('ORDER BY eligible.compatibility_score DESC, eligible.user_id ASC');
    expect(migrationSource).toContain('p_cursor_score INTEGER');
    expect(migrationSource).toContain('public.calculate_discovery_compatibility_score');
    expect(migrationSource).toContain('REVOKE ALL ON FUNCTION public.get_compatibility_candidate_page');
    expect(screenSource).toContain('onLoadMoreFeed={() => loadMore()}');
    expect(screenSource).toContain('hasMore={hasMore}');
    expect(screenSource).toContain('loadingMore={loadingMore}');
    expect(screenSource).toContain('loadMore');
  });

  it('keeps the social hot paths backed by keyset read models and composite indexes', () => {
    const chatPerformance = read('supabase/migrations/20260611220000_chat_performance_indexes_and_rpc.sql');
    const liveNowPerformance = read('supabase/migrations/20260715183000_final_reaudit_contracts.sql');
    const productionPerformance = read('supabase/migrations/20260718120000_production_integrity_hardening.sql');

    expect(chatPerformance).toContain('idx_messages_pair_created_at');
    expect(chatPerformance).toContain('idx_messages_receiver_sender_read_created_at');
    expect(liveNowPerformance).toContain('idx_currently_watching_live_keyset');
    expect(productionPerformance).toContain('idx_chat_pair_summaries_user1_activity');
    expect(productionPerformance).toContain('idx_chat_pair_summaries_user2_activity');
    expect(productionPerformance).toContain('idx_notification_events_push_outbox');
    expect(productionPerformance).toContain('CREATE OR REPLACE FUNCTION public.get_chat_directory_page');
  });

  it('updates profile movie collections through a service-only atomic RPC', () => {
    const edgeSource = readEdgeSource();
    const migrationSource = read('supabase/migrations/20260714224500_atomic_user_movie_collections_rpc.sql');
    const typedMigrationSource = read('supabase/migrations/20260715183000_final_reaudit_contracts.sql');
    const p0MigrationSource = read('supabase/migrations/20260715201000_p0_reaudit_closures.sql');
    const orderMigrationSource = read('supabase/migrations/20260719234500_movie_collection_order_contract.sql');

    expect(edgeSource).toContain('replace_user_media_collections');
    expect(edgeSource).not.toContain('const syncMovieCollection = async');
    expect(migrationSource).toContain('CREATE OR REPLACE FUNCTION public.replace_user_movie_collections');
    expect(typedMigrationSource).toContain('CREATE OR REPLACE FUNCTION public.replace_user_media_collections');
    expect(typedMigrationSource).toContain('PRIMARY KEY (user_id, media_type, movie_id, type)');
    expect(migrationSource).toContain('SECURITY DEFINER');
    expect(migrationSource).toContain('DELETE FROM public.user_movies');
    expect(migrationSource).toContain('INSERT INTO public.user_movies');
    expect(migrationSource).toContain('GRANT EXECUTE ON FUNCTION public.replace_user_movie_collections(UUID, INTEGER[], INTEGER[]) TO service_role');
    expect(migrationSource).toContain('REVOKE ALL ON FUNCTION public.replace_user_movie_collections(UUID, INTEGER[], INTEGER[]) FROM anon, authenticated');
    expect(p0MigrationSource).toContain("AND media_type = 'movie'");
    expect(p0MigrationSource).not.toContain('PERFORM public.replace_user_media_collections(p_user_id, v_favorites, v_watched)');
    expect(p0MigrationSource).toContain('CREATE TABLE IF NOT EXISTS public.media_identity_repair_history');
    expect(p0MigrationSource).toContain('INSERT INTO public.media_identity_repair_history');
    expect(p0MigrationSource).toContain('ON CONFLICT (user_id, media_type, movie_id, type) DO NOTHING');
    expect(p0MigrationSource).toContain('repair entry already closed');
    expect(p0MigrationSource).toContain('repair entry missing assumed media type');
    expect(p0MigrationSource).toContain('REVOKE ALL ON TABLE public.media_identity_repair_history FROM anon, authenticated, public');
    expect(orderMigrationSource).toContain('CREATE OR REPLACE FUNCTION public.replace_user_media_collections');
    expect(orderMigrationSource).toContain('ON CONFLICT (user_id, media_type, movie_id, type) DO UPDATE');
    expect(orderMigrationSource).toContain('SET created_at = EXCLUDED.created_at');
  });

  it('keeps movie library sync ordered and separate from watch-session transitions', () => {
    const appSource = readTogether('src/context/AppContext.tsx', 'src/context/app/librarySupport.ts');
    const edgeSource = readEdgeSource();
    const watchReturnTypeMigrationSource = read('supabase/migrations/20260720012500_watch_session_media_type_ambiguity_fix.sql');

    expect(appSource).toContain('const requestBody: Record<string, unknown>');
    expect(appSource).toContain('if (payload.watchingAction) {');
    expect(appSource).toContain('requestBody.currentlyWatching = payload.watchingId');
    expect(appSource).not.toContain('currentlyWatching: payload.watchingId,');
    expect(appSource).not.toContain("console.error('Movie sync error:'");
    expect(appSource).toContain("telemetry.captureException(error, { scope: 'movie_sync' })");
    expect(appSource).toContain("console.warn('Movie sync retry scheduled:', error)");
    expect(appSource).toContain('const libraryHydrationKey = useMemo(');
    expect(appSource).toContain('const hydrationUser = libraryUserRef.current;');
    expect(appSource).toContain('}, [libraryHydrationKey]);');
    expect(appSource).not.toContain('}, [user]);');
    expect(appSource).toContain('return [movie, ...movies];');
    expect(appSource.match(/const next = \[movie, \.\.\.current\];/g)?.length).toBeGreaterThanOrEqual(2);
    expect(edgeSource.match(/\.order\("created_at", \{ ascending: false \}\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(watchReturnTypeMigrationSource).toContain('CREATE OR REPLACE FUNCTION public.apply_watch_session_transition');
    expect(watchReturnTypeMigrationSource).toContain('#variable_conflict use_column');
    expect(watchReturnTypeMigrationSource).toContain('cw.media_type::TEXT');
    expect(watchReturnTypeMigrationSource).toContain('cw.state::TEXT');
    expect(watchReturnTypeMigrationSource).toContain('public.currently_watching.media_type::TEXT');
    expect(watchReturnTypeMigrationSource).toContain('public.currently_watching.state::TEXT');
  });

  it('uses redacted structured Edge request logging', () => {
    const source = readEdgeSource();

    expect(source).not.toContain('logger(console.log)');
    expect(source).toContain('requestId');
    expect(source).toContain('durationMs');
    expect(source).toContain('route: c.req.path');
  });

  it('delivers push notifications through a durable service-only retry outbox', () => {
    const edgeSource = readEdgeSource();
    const migrationSource = read('supabase/migrations/20260718120000_production_integrity_hardening.sql');
    const healthMigrationSource = read('supabase/migrations/20260819100000_push_delivery_health.sql');
    const receiptMigrationSource = read('supabase/migrations/20260819190000_push_delivery_receipts.sql');
    const schedulerSource = read('.github/workflows/push-outbox-drain.yml');
    const dispatchSource = edgeSource.slice(
      edgeSource.indexOf('const dispatchNotificationEvents = async'),
      edgeSource.indexOf('const notifyChatStatusChange = async'),
    );

    expect(migrationSource).toContain('push_attempt_count');
    expect(migrationSource).toContain('FOR UPDATE SKIP LOCKED');
    expect(migrationSource).toContain('CREATE OR REPLACE FUNCTION public.claim_push_delivery_jobs');
    expect(migrationSource).toContain('CREATE OR REPLACE FUNCTION public.complete_push_delivery_job');
    expect(edgeSource).toContain('const drainPushDeliveryOutbox = async');
    expect(edgeSource).toContain('NOTIFICATION_WORKER_SECRET');
    expect(edgeSource).toContain('job.attempt_count >= 5');
    expect(edgeSource).toContain('get_push_delivery_health');
    expect(dispatchSource).toContain('drainPushDeliveryOutbox');
    expect(dispatchSource).not.toContain('sendPushNotifications(');
    expect(healthMigrationSource).toContain('SECURITY DEFINER');
    expect(healthMigrationSource).toContain('stalled_count');
    expect(healthMigrationSource).toContain('REVOKE ALL ON FUNCTION public.get_push_delivery_health()');
    expect(receiptMigrationSource).toContain('CREATE TABLE IF NOT EXISTS public.push_delivery_receipts');
    expect(receiptMigrationSource).toContain("NOW() + INTERVAL '15 minutes'");
    expect(receiptMigrationSource).toContain('CREATE OR REPLACE FUNCTION public.claim_push_receipt_jobs');
    expect(edgeSource).toContain('const drainPushDeliveryReceipts = async');
    expect(schedulerSource).toContain("cron: '2/5 * * * *'");
    expect(schedulerSource).toContain('--retry 3');
    expect(schedulerSource).toContain('.health.dead == 0');
    expect(schedulerSource).toContain('.health.stalled == 0');
  });

  it('keeps shared interactive primitives at the 48 dp cross-platform target', () => {
    const themeSource = read('src/shared/theme/index.ts');
    const buttonSource = read('src/app/components/ui/AppButton.tsx');
    const iconButtonSource = read('src/app/components/ui/AppIconButton.tsx');
    const textFieldSource = read('src/app/components/ui/AppTextField.tsx');
    const segmentedSource = read('src/app/components/ui/SegmentedControl.tsx');

    expect(themeSource).toContain('controlMinIOS: 44');
    expect(themeSource).toContain('controlMinAndroid: 48');
    expect(themeSource).toContain('controlMinUnified: 48');

    for (const source of [buttonSource, iconButtonSource, textFieldSource, segmentedSource]) {
      expect(source).toContain('theme.layout.controlMinUnified');
    }
  });

  it('typechecks the Edge boundary against generated database types', () => {
    const edgeSource = readEdgeSource();
    const generatedTypes = read('supabase/types/database.generated.ts');

    expect(edgeSource).toContain('createClient<Database>');
    expect(edgeSource).toContain('from "../../types/database.generated.ts"');
    expect(generatedTypes).toContain('get_push_delivery_health');
    expect(generatedTypes).toContain('get_compatibility_candidate_page');
  });

  it('exposes release and schema readiness in the Edge health contract', () => {
    const source = readEdgeSource();
    const configSource = read('supabase/config.toml');
    const { version } = JSON.parse(read('package.json')) as { version: string };

    expect(source).toContain(`RELEASE_VERSION = "${version}"`);
    expect(configSource).toContain('[functions.make-server-d962235e]');
    expect(configSource).toContain('verify_jwt = true');
    expect(source).toContain('REQUIRED_SCHEMA_VERSION');
    expect(source).toContain('app.get("/make-server-d962235e/health"');
    expect(source).toContain('schemaReady');
    expect(source).toContain('requiredSchema');
    expect(source).toContain('serverTime');
    expect(source).toContain('SCHEMA_READINESS_CACHE_TTL_MS');
    expect(source).toContain('const getSchemaReady = (supabase: SupabaseAdminClient) =>');
    expect(source).toContain('const schemaReady = await getSchemaReady(supabase);');
    expect(source).toContain('supabase.rpc("get_chat_directory_page"');
    expect(source).toContain('supabase.rpc("get_compatibility_candidate_page"');
    expect(source).toContain('supabase.rpc("get_watch_discovery_candidate_page"');
    expect(source).toContain('supabase.rpc("get_chat_list_stats"');
  });

  it('keeps match selects aligned with the composite matches primary key', () => {
    const source = readEdgeSource();
    const matchSelect = source.slice(
      source.indexOf('const MATCH_SELECT ='),
      source.indexOf('const MESSAGE_SELECT ='),
    );

    expect(matchSelect).not.toMatch(/(^|,)id(,|$)/);
    expect(matchSelect).toContain('user1_id');
    expect(matchSelect).toContain('user2_id');
    expect(matchSelect).toContain('created_at');
  });

  it('keeps chat list message stats on the bounded RPC path', () => {
    const source = readEdgeSource();
    const statsFunction = source.slice(
      source.indexOf('const loadChatMessageStats = async'),
      source.indexOf('const fetchMatchBetweenUsers = async'),
    );

    expect(statsFunction).toContain('supabase.rpc("get_chat_list_stats"');
    expect(statsFunction).toContain('MAX_CHAT_MESSAGE_PEER_ROWS');
    expect(statsFunction).not.toContain('.limit(1000)');
  });

  it('does not hide critical API read failures behind empty fallbacks', () => {
    const source = read('src/services/api.ts');

    for (const functionName of [
      'getUsers',
      'getWatchDiscoveryUsers',
      'getCompatibilityDiscoveryEntries',
      'getLikesDiscovery',
      'getLikes',
      'getMatches',
      'getChatThread',
      'getChats',
      'getBlockedUsers',
    ]) {
      const start = source.indexOf(`export async function ${functionName}`);
      const end = source.indexOf('\nexport async function ', start + 1);
      const body = source.slice(start, end === -1 ? undefined : end);

      expect(body, functionName).not.toContain('return []');
      expect(body, functionName).not.toContain('return { likedUsers: [], likedByUsers: [] }');
      expect(body, functionName).not.toContain('return { liked: [], likedBy: [] }');
    }
  });

  it('does not convert TMDB transport failures into fake empty search results', () => {
    const source = read('src/services/tmdb.ts');
    const safeFetchSource = source.slice(
      source.indexOf('async function safeFetchResponse'),
      source.indexOf('async function searchWithLanguageFallback'),
    );

    expect(safeFetchSource).not.toContain('catch');
    expect(safeFetchSource).not.toContain('results: []');
    expect(safeFetchSource).toContain('return normalizeResponse');
  });

  it('shows typing presence in both the chat list and active thread', () => {
    const chatScreenSource = read('src/app/components/ChatScreen.tsx');
    const chatListItemSource = read('src/app/components/chat/ChatListItem.tsx');
    const chatModalSource = read('src/app/components/ChatModal.tsx');

    expect(chatScreenSource).toContain('ChatListItem');
    expect(chatListItemSource).toContain('useChatPresence');
    expect(chatListItemSource).toContain("t('chat.screen.preview.typing')");
    expect(chatModalSource).toContain('useChatPresence');
  });

  it('keeps the active chat mounted when opening a peer profile from the thread', () => {
    const source = read('src/app/components/ChatScreen.tsx');
    const profileOpenSource = source.slice(
      source.indexOf('onProfileClick={() => {'),
      source.indexOf('{profileChat ? ('),
    );

    expect(profileOpenSource).toContain('setProfileChat(activeChat);');
    expect(profileOpenSource).not.toContain('setActiveChat(null);');
  });

  it('loads Watch live-now users through the dedicated endpoint without match exclusions', () => {
    const liveNowSource = read('src/app/hooks/useLiveNowUsers.ts');
    const watchHomeSource = read('src/app/hooks/useWatchHomeController.ts');
    const apiSource = read('src/services/api.ts');
    const liveNowRoute = read(
      'supabase/functions/make-server-d962235e/domains/profileDiscovery.ts',
    );

    expect(apiSource).toContain('`/watch/live-now${buildQueryString');
    expect(liveNowSource).toContain('getLiveNowUsers');
    expect(liveNowSource).not.toContain('getUsers(true)');
    expect(liveNowSource).toContain('const currentFlight = inFlightRef.current');
    expect(liveNowSource).toContain('await currentFlight');
    expect(liveNowSource).toContain('if (!options.force)');
    expect(watchHomeSource).toContain('activeWatchingKey');
    expect(watchHomeSource).toContain('void refreshLiveNow({ force: true })');
    expect(liveNowRoute).toMatch(/supabase\.rpc\(\s*"get_live_now_users"/);
    expect(liveNowRoute).toContain('decodeLiveNowCursor');
    expect(liveNowRoute).toContain('encodeLiveNowCursor');
    expect(liveNowRoute).not.toContain('fetchActiveMatchedUserIdsForUser');
  });

  it('pages same-title watch discovery without a fixed candidate cap', () => {
    const edgeSource = readEdgeSource();
    const migrationSource = read('supabase/migrations/20260819090000_discovery_correctness_read_models.sql');
    const matchSource = read('src/app/components/MatchScreen.tsx');
    const routeSource = read(
      'supabase/functions/make-server-d962235e/domains/profileDiscovery.ts',
    );

    expect(routeSource).toContain('get_watch_discovery_candidate_page');
    expect(routeSource).not.toContain('loadWatchCandidatePageFallback');
    expect(routeSource).not.toContain('passesDiscoveryFilters');
    expect(routeSource).toContain('decodeLiveNowCursor');
    expect(routeSource).toContain('pageInfo');
    expect(routeSource).not.toContain('.limit(200)');
    expect(edgeSource).toContain('queueWatchSessionDiscoveryEvents');
    expect(edgeSource).toContain('{ reason: "watch_session" }');
    expect(migrationSource).toContain('ORDER BY eligible.updated_at DESC, eligible.user_id DESC');
    expect(matchSource).toContain('getMediaRefKey({ id: activeWatchingId');
    expect(matchSource).toContain('void refresh(true)');
    expect(matchSource).toContain('onLoadMoreFeed={activeWatchingId ? loadMore : undefined}');
    expect(matchSource).toContain('hasMore={Boolean(activeWatchingId && hasMore)}');
    expect(read('src/app/components/SwipeModal.tsx')).toContain('queue.length - currentQueueIndex > 5');
  });

  it('keeps media identity typed for currently-watching and live-now hydration', () => {
    const typeSource = read('src/shared/types/index.ts');
    const watchHomeSource = read('src/app/hooks/useWatchHomeController.ts');
    const edgeSource = readEdgeSource();
    const migrationSource = read('supabase/migrations/20260715162000_media_type_live_now_contract.sql');

    expect(typeSource).toContain("currentlyWatchingMediaType: MediaType | null");
    expect(typeSource).toContain('export interface MediaRef');
    expect(watchHomeSource).toContain('getMediaRefKey');
    expect(watchHomeSource).toContain('tmdbService.getMediaListByRefs');
    expect(watchHomeSource).toContain('LIVE_NOW_MEDIA_HYDRATION_BATCH_SIZE');
    expect(edgeSource).toContain('currentlyWatchingMediaType');
    expect(edgeSource).toContain('p_media_type:');
    expect(edgeSource).toContain('normalizedCurrentlyWatchingMediaType');
    expect(edgeSource).toContain('favoriteMedia');
    expect(edgeSource).toContain('watchedMedia');
    expect(migrationSource).toContain('user_movies_media_type_check');
    expect(migrationSource).toContain('currently_watching_media_type_check');
  });

  it('keeps compatibility scoring typed so movie and tv id collisions do not match', () => {
    const edgeSource = readEdgeSource();
    const compatibilitySource = read('src/shared/utils/compatibility.ts');
    const profileViewerSource = read('src/app/components/ProfileViewer.tsx');
    const likesSource = read('src/app/components/LikesScreen.tsx');
    const matchSource = read('src/app/components/MatchScreen.tsx');

    expect(compatibilitySource).toContain('getMediaRefKey');
    expect(compatibilitySource).toContain('commonFavoriteRefs');
    expect(edgeSource).toContain('favoriteMedia: MediaRef[]');
    expect(edgeSource).toContain('currentUserCollections.favoriteMedia');
    expect(profileViewerSource).toContain('currentFavoriteMedia');
    expect(likesSource).toContain('user.favoriteMedia?.length ? user.favoriteMedia : user.favoriteMovies');
    expect(matchSource).toContain('user.favoriteMedia?.length ? user.favoriteMedia : user.favoriteMovies');
  });

  it('recovers legacy chats from message peers without enabling sends without a match', () => {
    const edgeSource = readEdgeSource();
    const migrationSource = read('supabase/migrations/20260715201000_p0_reaudit_closures.sql');
    const chatsRoute = edgeSource.slice(
      edgeSource.indexOf('app.get("/make-server-d962235e/chats"'),
      edgeSource.indexOf('Deno.serve(app.fetch);'),
    );
    const messagesRoute = edgeSource.slice(
      edgeSource.indexOf('app.get("/make-server-d962235e/messages/:userId"'),
      edgeSource.indexOf('app.post("/make-server-d962235e/messages/:userId"'),
    );

    expect(migrationSource).toContain('CREATE OR REPLACE FUNCTION public.get_chat_message_peers');
    expect(edgeSource).toContain('get_chat_directory_page');
    expect(edgeSource).toContain('loadChatDirectoryPageFallback');
    expect(edgeSource).toContain('isMissingFunctionError(directoryError, "get_chat_directory_page")');
    expect(edgeSource).toContain('isMissingFunctionError(error, "get_chat_list_stats")');
    expect(edgeSource).toContain('get_chat_message_stats');
    expect(chatsRoute).toContain('decodeChatDirectoryCursor');
    expect(chatsRoute).toContain('pageInfo');
    expect(chatsRoute).toContain('matchMap.get(row.other_user_id) ?? null');
    expect(chatsRoute).not.toContain('if (!matches || matches.length === 0)');
    expect(messagesRoute).toContain('if (deletedChatAt)');
    expect(messagesRoute).toContain('if (!match && fetchedMessages.length === 0)');
    expect(edgeSource).toContain('canSend: Boolean(match)');
    expect(migrationSource).toContain('CREATE TABLE IF NOT EXISTS public.chat_repair_audit');
    expect(migrationSource).toContain('CREATE OR REPLACE FUNCTION public.refresh_chat_repair_audit');
    expect(migrationSource).toContain('CREATE OR REPLACE FUNCTION public.apply_chat_repair_audit');
    expect(migrationSource).toContain("reason TEXT NOT NULL");
    expect(migrationSource).toContain("messages_exist_without_match");
    expect(migrationSource).toContain('REVOKE ALL ON TABLE public.chat_repair_audit FROM anon, authenticated, public');
    expect(migrationSource).toContain('GRANT SELECT, INSERT, UPDATE ON TABLE public.chat_repair_audit TO service_role');
    expect(migrationSource).toContain("GRANT EXECUTE ON FUNCTION public.apply_chat_repair_audit(UUID) TO service_role");
  });

  it('uses a single RPC for watch session transitions with version conflict handling', () => {
    const migrationSource = read('supabase/migrations/20260715201000_p0_reaudit_closures.sql');
    const profileRoute = read(
      'supabase/functions/make-server-d962235e/domains/profileDiscovery.ts',
    );

    expect(migrationSource).toContain('CREATE OR REPLACE FUNCTION public.apply_watch_session_transition');
    expect(migrationSource).toContain('FOR UPDATE');
    expect(migrationSource).toContain('watch_version_conflict');
    expect(profileRoute).toMatch(/supabase\.rpc\(\s*"apply_watch_session_transition"/);
    expect(profileRoute).toContain('currentlyWatchingVersion');
    expect(profileRoute).toContain('conflict: conflictWatching');
    expect(profileRoute).toContain('}, 409)');
    expect(profileRoute).not.toContain('.from("currently_watching")\n          .upsert');
  });

  it('does not send incoming-like profile DTOs when likes are entitlement locked', () => {
    const screenSource = read('src/app/components/LikesScreen.tsx');
    const edgeSource = readEdgeSource();
    const likesRoute = edgeSource.slice(
      edgeSource.indexOf('app.get("/make-server-d962235e/discovery/likes"'),
      edgeSource.indexOf('app.get("/make-server-d962235e/matches"'),
    );

    expect(screenSource).not.toContain('likedMeRequiresPremium');
    expect(screenSource).toContain('likedByLocked');
    expect(likesRoute).toContain('incomingLikesUnlocked');
    expect(likesRoute).toContain('likedByUsers: incomingLikesUnlocked');
    expect(likesRoute).toContain('likedByUserIds: incomingLikesUnlocked ? likedByUserIds : []');
    expect(likesRoute).toContain('likedByLocked: !incomingLikesUnlocked');
  });

  it('uses tuple chat cursors instead of created-at-only pagination', () => {
    const modalSource = read('src/app/components/ChatModal.tsx');
    const apiSource = read('src/services/api.ts');
    const edgeSource = readEdgeSource();
    const messagesRoute = edgeSource.slice(
      edgeSource.indexOf('app.get("/make-server-d962235e/messages/:userId"'),
      edgeSource.indexOf('app.post("/make-server-d962235e/messages/:userId"'),
    );

    expect(apiSource).toContain('options?: { before?: string; cursor?: string; limit?: number }');
    expect(modalSource).toContain('olderMessagesCursorRef');
    expect(modalSource).toContain('cursor: nextCursor');
    expect(modalSource).not.toContain('before: oldestServerMessage.created_at');
    expect(messagesRoute).toContain('decodeMessageCursor');
    expect(messagesRoute).toContain('.order("id", { ascending: false })');
    expect(messagesRoute).toContain('id.lt.');
    expect(messagesRoute).toContain('encodeMessageCursor');
  });

  it('subscribes chat presence to the peer presence channel', () => {
    const source = read('src/app/hooks/useChatPresence.ts');

    expect(source).toContain('buildTypingBroadcastTopic(pairKey)');
    expect(source).toContain('buildAppPresenceTopic(otherUserId)');
    expect(source).toContain('controller.presenceChannel.presenceState<AppPresencePayload>()');
    expect(source).toContain('private: true');
    expect(source).not.toContain('subscribeToAppPresence');
  });

  it('keeps chat typing and presence on the authorized pair topic', () => {
    const source = read('src/app/hooks/useChatPresence.ts');
    const conversationControllerSource = source.slice(
      source.indexOf('function createConversationController'),
      source.indexOf('async function removeConversationController'),
    );

    expect(source).toContain('buildTypingBroadcastTopic');
    expect(source).toContain('const buildTypingBroadcastTopic = buildConversationTopic');
    expect(conversationControllerSource).toContain('buildTypingBroadcastTopic(pairKey)');
    expect(conversationControllerSource).toContain("presenceChannel.on('presence'");
    expect(conversationControllerSource).toContain("channel.on('broadcast'");
    expect(source).toContain('conversationRemovalFlights');
    expect(source).toContain('CONVERSATION_CHANNEL_IDLE_MS');
    expect(source).not.toContain('conversation-typing:');
  });

  it('opens chat threads on the latest message without auto-loading older pages', () => {
    const source = readTogether(
      'src/app/components/ChatModal.tsx',
      'src/app/components/chat/ChatThreadList.tsx',
    );
    const modelSource = read('src/app/components/chat/chatMessageModel.ts');

    expect(modelSource).toContain('new Date(right.created_at).getTime() - new Date(left.created_at).getTime()');
    expect(source).toContain('inverted');
    expect(source).toContain('userScrolledMessagesRef');
    expect(source).toContain('scrollToOffset({ offset: 0, animated })');
    expect(source).toContain('onEndReached={onLoadOlder}');
    expect(source).toContain('userScrolledMessagesRef.current && !loading && !loadingOlderMessages');
    expect(source).not.toContain('onContentSizeChange');
  });

  it('keeps the reader anchored when older chat pages are appended to the inverted list', () => {
    const source = readTogether(
      'src/app/components/ChatModal.tsx',
      'src/app/components/chat/ChatThreadList.tsx',
    );

    expect(source).toContain('maintainVisibleContentPosition={MAINTAIN_VISIBLE_POSITION}');
    expect(source).toContain('MAINTAIN_VISIBLE_POSITION = { minIndexForVisible: 0 } as const');
    expect(source).toContain('ListFooterComponent=');
    expect(source).not.toContain('pendingPrependAnchorRef');
    expect(source).not.toContain('contentHeightRef');
    expect(source).toContain('const shouldAutoScroll = isNearLatestMessage()');
    expect(source).toContain('if (shouldAutoScroll)');
  });

  it('deduplicates automatic live-now refreshes during startup', () => {
    const source = read('src/app/hooks/useLiveNowUsers.ts');

    expect(source).toContain('REFRESH_DEDUPE_MS');
    expect(source).toContain('inFlightRef');
    expect(source).toContain('lastFetchAtRef');
    expect(source).toContain('return inFlightRef.current');
  });

  it('does not store local signup photos in auth metadata or clear the draft before verification', () => {
    const authSource = readTogether('src/context/AuthContext.tsx', 'src/context/auth/authSupport.ts');
    const signupSource = read('src/app/components/SignUpScreen.tsx');
    const draftSource = read('src/services/signupDraft.ts');
    const handleSubmitStart = signupSource.indexOf('const handleSubmit');
    const handleSubmitEnd = signupSource.indexOf('\n  return (', handleSubmitStart);
    const handleSubmitBody = signupSource.slice(handleSubmitStart, handleSubmitEnd);

    expect(authSource).toContain('safeMetadataPhotos');
    expect(authSource).toContain('/^https:\\/\\//i');
    expect(authSource).toContain('photos: safeMetadataPhotos');
    expect(authSource).toContain('finalizeSignupDraftPhotos');
    expect(authSource).toContain('clearSignupDraft');
    expect(draftSource).toContain('SecureStore.setItemAsync');
    expect(draftSource).toContain('removeLegacyDrafts');
    expect(signupSource).not.toContain('AsyncStorage');
    expect(handleSubmitBody).not.toContain('clearSignupDraft');
  });

  it('restores valid sessions from the last private profile snapshot without blocking on cache age', () => {
    const authSource = readTogether('src/context/AuthContext.tsx', 'src/context/auth/authSupport.ts');
    const telemetrySource = read('src/services/telemetry.ts');

    expect(authSource).not.toContain('AUTH_PROFILE_CACHE_TTL_MS');
    expect(authSource).toContain('SecureStore.setItemAsync');
    expect(authSource).toContain("profileResult.status === 'unavailable'");
    expect(authSource).toContain('readCachedProfile(session.user.id)');
    expect(authSource).toContain('purgeLocalAuthSession(signedOutUserId)');
    expect(authSource).toContain('await Promise.allSettled([');
    expect(authSource).toContain('preserveEqualUser');
    expect(telemetrySource).toContain("if (typeof value === 'string')");
    expect(telemetrySource).toContain('return sanitizeText(value)');
  });

  it('keeps signup gender selection distinct from the other option', () => {
    const source = read('src/app/components/SignUpScreen.tsx');

    expect(source).toContain("useState<UserGender | null>(null)");
    expect(source).toContain('USER_GENDERS.map');
    expect(source).toContain('gender != null');
    expect(source).not.toContain("gender !== 'other'");
    expect(source).not.toContain("gender === 'other'");
  });

  it('requires logout confirmation on settings and verify-email screens', () => {
    const settingsSource = read('src/app/components/SettingsModal.tsx');
    const verifySource = read('src/app/components/VerifyEmailScreen.tsx');

    expect(settingsSource).toContain('const confirmLogout');
    expect(settingsSource).toContain("Alert.alert(t('settings.logout.title')");
    expect(verifySource).toContain('const confirmLogout');
    expect(verifySource).toContain("Alert.alert(t('settings.logout.title')");
    expect(verifySource).not.toContain('onPress={() => void onLogout()}');
  });

  it('validates Letterboxd hostnames with an exact domain boundary', () => {
    const source = read('src/shared/config/externalLinks.ts');

    expect(source).toContain('host !== LETTERBOXD_HOSTNAME');
    expect(source).toContain('host.endsWith(`.${LETTERBOXD_HOSTNAME}`)');
    expect(source).not.toContain("host.endsWith('letterboxd.com')");
  });

  it('keeps signup single-password and exposes password strength feedback', () => {
    const source = readTogether(
      'src/app/components/SignUpScreen.tsx',
      'src/app/components/signup/PasswordStrength.tsx',
    );

    expect(source).not.toContain('confirmPassword');
    expect(source).toContain('passwordStrength');
    expect(source).toContain('auth.signup.passwordStrength.title');
  });

  it('keeps likes discovery on a synchronized horizontal pager', () => {
    const source = read('src/app/components/LikesScreen.tsx');

    expect(source).toContain('pagingEnabled');
    expect(source).toContain('onMomentumScrollEnd');
    expect(source).toContain('pagerRef.current?.scrollToIndex');
  });

  it('renders compatibility as a direct inline swipe deck', () => {
    const appSource = read('src/app/App.tsx');
    const compatibilitySource = read('src/app/components/CompatibilityScreen.tsx');
    const swipeModalSource = read('src/app/components/SwipeModal.tsx');

    expect(compatibilitySource).toContain('<SwipeModal');
    expect(compatibilitySource).toContain('presentation="inline"');
    expect(compatibilitySource).toContain('onLoadMoreFeed={() => loadMore()}');
    expect(compatibilitySource).toContain('SwipeDeckSkeleton');
    expect(compatibilitySource).not.toContain('UserMiniCard');
    expect(compatibilitySource).not.toContain('FlatList');
    expect(swipeModalSource).toContain("presentation?: 'modal' | 'inline'");
    expect(swipeModalSource).toContain("const isInline = presentation === 'inline'");
    expect(swipeModalSource).toContain('return <View style={styles.container}>{content}</View>');
    expect(appSource).toContain("tab === 'match' || tab === 'compatibility'");
  });

  it('keeps three columns on normal screens and adapts dense grids on narrow devices', () => {
    const compatibilitySource = read('src/app/components/CompatibilityScreen.tsx');
    const likesSource = readTogether(
      'src/app/components/LikesScreen.tsx',
      'src/app/components/likes/LikesGridPage.tsx',
    );
    const profileSource = readTogether(
      'src/app/components/ProfileCard.tsx',
      'src/app/components/profile/ProfileMediaLibrary.tsx',
    );
    const cardSource = read('src/app/components/UserMiniCard.tsx');
    const skeletonSource = read('src/app/components/ui/Skeleton.tsx');

    expect(likesSource).toContain('const LIKES_GRID_COLUMNS = 3');
    expect(likesSource).toContain('numColumns={columns}');
    expect(likesSource).toContain('pageWidth < LIKES_COMPACT_BREAKPOINT ? 2 : LIKES_GRID_COLUMNS');
    expect(likesSource).toContain('getFixedGridItemWidth');
    expect(likesSource).toContain('itemStyle={gridItemStyle}');
    expect(profileSource).toContain('columns = availableWidth < 350 ? 2 : 3');
    expect(profileSource).toContain('onLayout={handleLayout}');
    expect(profileSource).toContain('getFixedGridItemWidth');
    expect(profileSource).toContain('width={movieWidth}');
    expect(compatibilitySource).not.toContain('numColumns={2}');
    expect(likesSource).not.toContain('numColumns={2}');
    expect(cardSource).not.toContain("width: '46.8%'");
    expect(skeletonSource).toContain('columns?: number');
  });

  it('supports profile image galleries without changing movie previews', () => {
    const modalSource = read('src/app/components/ui/ImagePreviewModal.tsx');
    const profileSource = read('src/app/components/ProfileCard.tsx');

    expect(modalSource).toContain('images?: string[]');
    expect(modalSource).toContain('initialIndex');
    expect(modalSource).toContain('pagingEnabled');
    expect(profileSource).toContain("photoNavigationMode?: 'buttons' | 'swipe'");
    expect(profileSource).toContain('FlatList');
    expect(profileSource).toContain('pagingEnabled');
    expect(profileSource).toContain('directionalLockEnabled');
    expect(profileSource).toContain("scrollEnabled={resolvedPhotoNavigationMode === 'swipe' && photos.length > 1}");
    expect(profileSource).toContain('images={photos}');
  });

  it('keeps release Android permissions least privilege', () => {
    const appConfig = JSON.parse(read('app.json')) as {
      expo?: { android?: { permissions?: string[] } };
    };
    const mergedExpoConfig = JSON.parse(
      execFileSync(process.execPath, [EXPO_CLI, 'config', '--json'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    ) as { android?: { permissions?: string[] } };
    const permissions = appConfig.expo?.android?.permissions ?? [];
    const mergedPermissions = mergedExpoConfig.android?.permissions ?? [];
    const manifestSource = read('android/app/src/main/AndroidManifest.xml');

    for (const permissionList of [permissions, mergedPermissions]) {
      expect(permissionList).not.toContain('android.permission.RECORD_AUDIO');
      expect(permissionList).not.toContain('android.permission.READ_MEDIA_IMAGES');
      expect(permissionList).not.toContain('android.permission.SYSTEM_ALERT_WINDOW');
    }

    expect(read('app.json')).toContain('"microphonePermission": false');
    expect(manifestSource).toContain('android.permission.CAMERA" tools:node="remove"');
    expect(manifestSource).toContain('android.permission.RECORD_AUDIO" tools:node="remove"');
    expect(manifestSource).toContain('android.permission.SYSTEM_ALERT_WINDOW" tools:node="remove"');
    expect(manifestSource).toContain('android.permission.WRITE_EXTERNAL_STORAGE" tools:node="remove"');
    expect(manifestSource).not.toContain('exp+wmatch');
    expect(manifestSource).toContain('android:autoVerify="true"');
  }, 30000);

  it('keeps checked-in Android navigation behavior aligned with Expo config', () => {
    const appConfig = JSON.parse(read('app.json')) as {
      expo?: { android?: { predictiveBackGestureEnabled?: boolean } };
    };
    const manifestSource = read('android/app/src/main/AndroidManifest.xml');
    const gradleProperties = read('android/gradle.properties');
    const rootSource = read('App.tsx');

    expect(appConfig.expo?.android?.predictiveBackGestureEnabled).toBe(true);
    expect(manifestSource).toContain('android:enableOnBackInvokedCallback="true"');
    expect(gradleProperties).toContain('edgeToEdgeEnabled=true');
    expect(rootSource).not.toContain('NativeStatusBar.setTranslucent(false)');
  });

  it('keeps Expo Doctor and dependency drift checks blocking in CI', () => {
    const workflowSource = read('.github/workflows/ci.yml');

    expect(workflowSource).toContain('npm run check:audit');
    expect(workflowSource).toContain('npx expo install --check');
    expect(workflowSource).toContain('npm run doctor');
    expect(workflowSource).not.toContain('continue-on-error: true');
  });

  it('keeps release verification scripts wired to blocking checks', () => {
    const packageJson = JSON.parse(read('package.json')) as {
      scripts?: Record<string, string>;
    };
    const scripts = packageJson.scripts ?? {};

    for (const scriptName of [
      'format:check',
      'lint',
      'test:unit',
      'test:component',
      'test:contract',
      'test:rls',
      'check:edge',
      'check:edge:type',
      'check:licenses',
      'check:migrations',
      'verify:release',
    ]) {
      expect(scripts[scriptName], scriptName).toBeTruthy();
    }

    expect(scripts['verify:release']).toContain('npm run format:check');
    expect(scripts['verify:release']).toContain('npm run lint');
    expect(scripts['verify:release']).toContain('npm run check:signing');
    expect(scripts['verify:release']).toContain('npm run check:secrets');
    expect(scripts['verify:release']).toContain('npm run check:licenses');
    expect(scripts['verify:release']).toContain('npm run check:i18n');
    expect(scripts['verify:release']).toContain('npm run typecheck');
    expect(scripts['verify:release']).toContain('npm run test:unit');
    expect(scripts['verify:release']).toContain('npm run test:component');
    expect(scripts['verify:release']).toContain('npm run test:contract');
    expect(scripts['verify:release']).toContain('npm run test:rls');
    expect(scripts['verify:release']).toContain('npm run check:edge');
    expect(scripts['verify:release']).toContain('npm run check:edge:type');
    expect(scripts['verify:release']).toContain('npm run check:migrations');
    expect(scripts['verify:release']).toContain('npm run check:audit');
    expect(scripts['verify:release']).toContain('npx expo install --check');
    expect(scripts['verify:release']).toContain('npm run doctor');
  });

  it('exposes Settings legal documents and TMDB attribution', () => {
    const settingsSource = read('src/app/components/SettingsModal.tsx');
    const externalLinksSource = read('src/shared/config/externalLinks.ts');
    const trSource = read('src/shared/i18n/locales/tr.ts');

    expect(settingsSource).toContain('getPrivacyPolicyUrl');
    expect(settingsSource).toContain('getTermsOfUseUrl');
    expect(settingsSource).toContain('TMDB_ATTRIBUTION_URL');
    expect(externalLinksSource).toContain('https://www.themoviedb.org/');
    expect(settingsSource).toContain("t('settings.row.about.title')");
    expect(settingsSource).toContain("t('settings.about.tmdb.attribution')");
    expect(settingsSource).toContain('accessibilityRole="link"');
    expect(trSource).toContain('settings.about.tmdb.attribution');
    expect(trSource).toContain("Bu ürün TMDB API'sini kullanır");
  });

  it('keeps a bounded LRU of visited tabs while only the focused scene is interactive', () => {
    const source = read('src/app/App.tsx');
    const sceneSource = read('src/app/components/ui/TabScene.tsx');
    const liveNowSource = read('src/app/hooks/useLiveNowUsers.ts');

    expect(source).toContain('residentTabs');
    expect(source).toContain('MAX_RESIDENT_TABS = getResidentTabLimit()');
    expect(source).toContain('const renderTab = (tab: AppTab) =>');
    expect(source).toContain('switch (tab)');
    expect(source).toContain("case 'watch':");
    expect(source).toContain("case 'profile':");
    expect(source).toContain('<TabScene');
    expect(sceneSource).toContain("pointerEvents={active ? 'auto' : 'none'}");
    expect(liveNowSource).toContain('if (!userId || !isFocused)');
  });

  it('uses warm discovery cache instead of reload-on-mount spinners', () => {
    const source = read('src/app/hooks/useDiscoveryData.ts');
    const cachedBranch = source.slice(
      source.indexOf('if (cachedSnapshot)'),
      source.indexOf('if (currentUserId)', source.indexOf('if (cachedSnapshot)')),
    );

    expect(source).toContain('DISCOVERY_CACHE_TTL_MS = 300_000');
    expect(source).toContain('discoveryLoadFlights');
    expect(source).toContain('preloadDiscoveryData');
    expect(source).toContain('loadInFlightRef');
    expect(cachedBranch).toContain("setStatus('success')");
    expect(cachedBranch).not.toContain('loadData()');
  });

  it('renders cached chat results immediately, including a successful empty list', () => {
    const source = read('src/app/components/ChatScreen.tsx');
    const cacheSource = read('src/services/chatCache.ts');

    expect(cacheSource).toContain('CHAT_LIST_CACHE_TTL_MS = 5 * 60 * 1000');
    expect(cacheSource).toContain('chatListFlights');
    expect(source).toContain('preloadChatList');
    expect(source).toContain('Boolean(currentUser && !initialChatCacheEntry)');
    expect(source).toContain('if (cachedEntry)');
    expect(source).toContain("void loadChats('silent')");
    expect(source).toContain('hasChatListCache(requestUserId)');
    expect(source).toContain('loadError && chats.length === 0 && !stale');
  });

  it('loads a bounded recent chat snapshot immediately and pages older messages on demand', () => {
    const modalSource = read('src/app/components/ChatModal.tsx');
    const cacheSource = read('src/services/chatCache.ts');
    const constantsSource = read('src/shared/constants/index.ts');
    const edgeSource = readEdgeSource();

    expect(constantsSource).toContain('CHAT_THREAD_INITIAL_PAGE_SIZE = 33');
    expect(cacheSource).toContain('CHAT_THREAD_CACHE_TTL_MS = 15 * 60 * 1000');
    expect(cacheSource).toContain('.slice(-CHAT_THREAD_INITIAL_PAGE_SIZE)');
    expect(modalSource).toContain('sortMessages(initialCachedThread?.messages.map(toLocalMessage) ?? [])');
    expect(modalSource).toContain('syncThread(Boolean(initialCachedThread), true, true)');
    expect(modalSource).toContain('silently && !replaceRecentPage');
    expect(modalSource).toContain('messages.length > CHAT_THREAD_INITIAL_PAGE_SIZE');
    expect(modalSource).toContain('userScrolledMessagesRef.current');
    expect(modalSource).toContain('void loadOlderMessages()');
    expect(modalSource).toContain('preloadChatThread(currentUserId, chat.userId, true)');
    expect(edgeSource).toContain('DEFAULT_CHAT_THREAD_PAGE_SIZE = CHAT_THREAD_INITIAL_PAGE_SIZE');
  });

  it('warms adaptive tab resources through the priority scheduler after the first frame', () => {
    const source = read('src/app/hooks/useAppDataWarmup.ts');
    const appSource = read('src/app/App.tsx');
    const schedulerSource = read('src/services/launchScheduler.ts');
    const usageSource = read('src/services/tabUsage.ts');

    expect(source).toContain('FIRST_USEFUL_CONTENT_GRACE_MS = 450');
    expect(source).toContain('await waitForIdle()');
    expect(source).toContain("await preloadTabData(userId, tab, 'idle')");
    expect(source).toContain('loadTabWarmupOrder(userId, currentTab)');
    expect(source).toContain('await Promise.all');
    expect(source).toContain('for (const tab of warmupOrder)');
    expect(source).toContain("getAppState() !== 'active'");
    expect(source).not.toContain('preloadChatThread');
    expect(source).toContain("preloadDiscoveryData('watch', userId)");
    expect(source).toContain('preloadSwipeQuota(userId)');
    expect(appSource).toContain('useAppDataWarmup(user, activeTab)');
    expect(schedulerSource).toContain('getLaunchTaskConcurrency()');
    expect(schedulerSource).toContain('getNetworkConcurrencyLimit()');
    expect(schedulerSource).toContain("critical: 0");
    expect(schedulerSource).toContain("intent: 1");
    expect(usageSource).toContain('MAX_HISTORY_LENGTH = 3');
    expect(usageSource).toContain('.slice(0, 2)');
  });

  it('centralizes app lifecycle work and bounds prioritized media prefetching', () => {
    const lifecycleSource = read('src/shared/utils/appLifecycle.ts');
    const mediaQueueSource = read('src/shared/utils/mediaPrefetchQueue.ts');
    const sourceFiles = [
      'src/app/hooks/useAppDataWarmup.ts',
      'src/app/hooks/useAppPresence.ts',
      'src/app/hooks/useChatPresence.ts',
      'src/app/hooks/useLiveNowUsers.ts',
      'src/services/chatOutbox.ts',
      'src/services/notifications.ts',
    ];

    expect(lifecycleSource).toContain("AppState.addEventListener('change'");
    for (const file of sourceFiles) {
      expect(read(file)).not.toContain('AppState.addEventListener');
    }
    expect(mediaQueueSource).toContain('getMediaPrefetchConcurrency()');
    expect(mediaQueueSource).toContain('getMediaQueueLimit()');
    expect(mediaQueueSource).toContain('critical: 0');
    expect(mediaQueueSource).toContain('intent: 1');
    expect(mediaQueueSource).toContain('predictive: 2');
    expect(mediaQueueSource).toContain('idle: 3');
    expect(mediaQueueSource).toContain("getAppState() !== 'active'");
  });

  it('keeps the primary profile gesture and imagery off the JS-heavy legacy path', () => {
    const profileCardSource = readTogether(
      'src/app/components/ProfileCard.tsx',
      'src/app/components/profile/useProfileCardGesture.ts',
    );
    const imageSource = read('src/app/components/ui/AppImage.tsx');
    const rootSource = read('App.tsx');

    expect(rootSource).toContain('GestureHandlerRootView');
    expect(profileCardSource).toContain('Gesture.Pan()');
    expect(profileCardSource).toContain('useAnimatedStyle');
    expect(profileCardSource).toContain('runOnJS(commitDown)');
    expect(profileCardSource).toContain("import AppImage from './ui/AppImage'");
    expect(imageSource).toContain("cachePolicy={stableCacheKey ? 'memory' : 'memory-disk'}");
    expect(read('src/context/AuthContext.tsx')).toContain('clearPrivateImageMemoryCache()');
    expect(imageSource).toContain('getStableImageCacheKey(uri)');
    expect(imageSource).toContain('enforceEarlyResizing = true');
    expect(imageSource).not.toContain('blurhash');
    expect(profileCardSource).not.toContain('PanResponder');
    expect(profileCardSource).not.toContain('ImageBackground');
  });

  it('hydrates watch data stale-while-revalidate and cancels obsolete searches', () => {
    const controllerSource = read('src/app/hooks/useWatchHomeController.ts');
    const snapshotSource = read('src/services/watchHomeSnapshot.ts');
    const tmdbSource = read('src/services/tmdb.ts');
    const edgeSource = readEdgeSource();

    expect(controllerSource).toContain('readWatchHomeSnapshot()');
    expect(controllerSource).toContain('new AbortController()');
    expect(controllerSource).toContain('searchAbortControllerRef.current?.abort()');
    expect(snapshotSource).toContain('MAX_STALE_AGE_MS');
    expect(tmdbSource).toContain('getMediaListByRefs');
    expect(edgeSource).toContain('/make-server-d962235e/tmdb/media-batch');
  });

  it('commits bottom navigation feedback before rendering the expensive destination screen', () => {
    const appSource = read('src/app/App.tsx');
    const navSource = read('src/app/components/BottomNav.tsx');
    const sceneSource = read('src/app/components/ui/TabScene.tsx');

    expect(appSource).not.toContain('useDeferredValue');
    expect(appSource).toContain('setActiveTab(tab)');
    expect(appSource).toContain('renderedResidentTabs.map((tab) =>');
    expect(appSource).toContain("preloadTabData(userId, tab, 'intent')");
    expect(appSource).toContain('preloadTabModule(tab)');
    expect(appSource).toContain("telemetry.recordDuration(");
    expect(appSource).toContain("'navigation.tab_committed'");
    expect(appSource).toContain("tab === 'chat'");
    expect(appSource).toContain('<ChatListSkeleton />');
    expect(appSource).toContain('<SwipeDeckSkeleton />');
    expect(navSource).toContain('onIntent={() => onTabIntent?.(item.id)}');
    expect(navSource).toContain('export default memo(BottomNav)');
    expect(sceneSource).toContain("mode={active ? 'visible' : 'hidden'}");
  });

  it('streams visible home sections independently and keeps speculative media off the critical path', () => {
    const appSource = read('src/app/App.tsx');
    const watchHomeSource = read('src/app/hooks/useWatchHomeController.ts');
    const watchSource = read('src/app/components/WatchScreen.tsx');

    expect(appSource).not.toContain('tmdbService.getTrending(1)');
    expect(watchHomeSource).toContain('tmdbService.getPopularMovies(1)');
    expect(watchHomeSource).toContain('tmdbService.getPopularTVShows(1)');
    expect(watchHomeSource).toContain('.finally(() => setLoadingMovies(false))');
    expect(watchHomeSource).toContain('.finally(() => setLoadingTV(false))');
    expect(watchHomeSource).toContain('readWatchHomeSnapshot()');
    expect(watchSource).toContain('popularMoviesLoading');
    expect(watchSource).toContain('popularTVLoading');
  });

  it('deduplicates discovery slices, quota refreshes, and speculative media work', () => {
    const discoverySource = read('src/app/hooks/useDiscoveryData.ts');
    const quotaSource = read('src/app/hooks/useSwipeQuota.ts');
    const mediaQueueSource = read('src/shared/utils/mediaPrefetchQueue.ts');

    expect(discoverySource).toContain('DISCOVERY_REVALIDATE_AFTER_MS = 30_000');
    expect(discoverySource).toContain('likesSliceFlights');
    expect(discoverySource).toContain('preloadLikesSlice(userId, force)');
    expect(quotaSource).toContain('SWIPE_QUOTA_REVALIDATE_AFTER_MS = 30_000');
    expect(quotaSource).toContain('refreshState(userId, false)');
    expect(mediaQueueSource).toContain('getMediaPrefetchConcurrency()');
    expect(mediaQueueSource).toContain('const flights = new Map');
  });

  it('keeps match presentation optimistic and moves notification side effects off the response path', () => {
    const matchSource = read('src/app/components/MatchScreen.tsx');
    const swipeSource = read('src/app/components/SwipeModal.tsx');
    const edgeSource = readEdgeSource();
    const likeRoute = edgeSource.slice(
      edgeSource.indexOf('app.post("/make-server-d962235e/likes/:userId"'),
      edgeSource.indexOf('app.post("/make-server-d962235e/likes/:userId/undo"'),
    );

    expect(matchSource).toContain('<SwipeModal');
    expect(matchSource).not.toContain('predictedInstantMatch');
    expect(swipeSource).toContain('predictedInstantMatch');
    expect(swipeSource).toContain('interactionLockedRef.current = false');
    expect(swipeSource).toContain('setMatchedUser(entry.user)');
    expect(likeRoute).toContain('runAfterResponse(matchNotificationTask)');
    expect(likeRoute).toContain('runAfterResponse(likeNotificationTask)');
    expect(likeRoute).toContain('matchedUser: null');
    expect(likeRoute).not.toContain('await loadUserPayloadMap');
  });

  it('bounds Live Now payloads and hydrates media progressively', () => {
    const constantsSource = read('src/shared/constants/index.ts');
    const hookSource = read('src/app/hooks/useLiveNowUsers.ts');
    const watchHomeSource = read('src/app/hooks/useWatchHomeController.ts');
    const edgeSource = readEdgeSource();

    expect(constantsSource).toContain('LIVE_NOW_PAGE_SIZE = 16');
    expect(hookSource).toContain('limit: LIVE_NOW_PAGE_SIZE');
    expect(watchHomeSource).toContain('LIVE_NOW_MEDIA_HYDRATION_BATCH_SIZE = 6');
    expect(watchHomeSource).toContain('const commit = () =>');
    expect(watchHomeSource).toContain('tmdbService.getMediaListByRefs');
    expect(edgeSource).toContain('c.req.query("limit") ?? LIVE_NOW_PAGE_SIZE');
  });

  it('uses one consistent native pull-to-refresh control across data screens', () => {
    const refreshSource = read('src/app/components/ui/AppRefreshControl.tsx');

    expect(refreshSource).toContain('tintColor={theme.colors.primarySoft}');
    expect(refreshSource).toContain('colors={[theme.colors.primarySoft]}');
    expect(refreshSource).toContain('progressBackgroundColor={theme.colors.backgroundElevated}');

    for (const file of [
      'src/app/components/WatchScreen.tsx',
      'src/app/components/ChatScreen.tsx',
      'src/app/components/CompatibilityScreen.tsx',
      'src/app/components/likes/LikesGridPage.tsx',
      'src/app/components/MatchScreen.tsx',
      'src/app/components/ProfileCard.tsx',
    ]) {
      expect(read(file), file).toContain('AppRefreshControl');
    }
  });

  it('serializes push-token sync so startup and foreground work cannot race', () => {
    const source = read('src/services/notifications.ts');
    const appSource = read('src/app/App.tsx');
    const edgeSource = readEdgeSource();

    expect(source).toContain('let pushSyncInFlight:');
    expect(source).toContain('pushSyncInFlight.userId === normalizedUserId');
    expect(source).toContain('pushSyncInFlight.requestPermission');
    expect(source).toContain('requestPermission && shouldRequestNotificationPermission(finalPermissions)');
    expect(source).toContain('return pushSyncInFlight.promise');
    expect(source).toContain('await pushSyncInFlight?.promise');
    expect(source).toContain('Notifications.IosAuthorizationStatus.PROVISIONAL');
    expect(source).toContain('Notifications.addPushTokenListener');
    expect(source).toContain('PUSH_RETRY_DELAYS_MS');
    expect(source).toContain('PUSH_REGISTRATION_STORAGE_KEY');
    expect(source).toContain('Notifications.getNotificationChannelAsync');
    expect(source).toContain('Notifications.AndroidImportance.NONE');
    expect(source).toContain('android.settings.CHANNEL_NOTIFICATION_SETTINGS');
    expect(source).toContain('allowProvisional: false');
    expect(source).toContain('deactivateStoredPushRegistration(userId)');
    expect(edgeSource).toContain('getExpoPushHeaders()');
    expect(edgeSource).toContain('fetchExpoPushWithRetry');
    expect(edgeSource).toContain('await drainPushDeliveryOutbox(supabase);');
    expect(edgeSource.indexOf('if (acceptedCount > 0)')).toBeLessThan(
      edgeSource.indexOf('if (retryableErrors.length > 0)'),
    );
    expect(edgeSource).toContain('for (const message of messages)');
    expect(edgeSource).toContain('permanentErrors.push(`expo_ticket_${errorCode ?? "unknown"}`)');
    expect(appSource).toContain('void syncCurrentUserPush(user?.id)');
    expect(appSource).toContain('subscribeToPushTokenChanges(user?.id)');
    expect(appSource).toContain('pushPermissionRequestedUserIdsRef');
    expect(appSource).toContain('void requestPushNotifications(currentUserId)');
    expect(appSource).toContain('openPushNotificationSettings');
    expect(appSource).toContain("if (tab === 'chat')");
    expect(appSource).toContain('requestPushNotifications(userId)');
  });

  it('restores the chat composer and exposes bounded failed-message actions', () => {
    const modalSource = readTogether(
      'src/app/components/ChatModal.tsx',
      'src/app/components/chat/ChatComposer.tsx',
      'src/app/components/chat/ChatThreadList.tsx',
      'src/app/hooks/useChatKeyboard.ts',
    );
    const validationSource = read('src/shared/utils/validation.ts');

    expect(modalSource).toContain("behavior={Platform.OS === 'ios' ? 'padding' : undefined}");
    expect(modalSource).toContain("enabled={Platform.OS === 'ios'}");
    expect(modalSource).toContain('calculateKeyboardInset(');
    expect(modalSource).toContain('ANDROID_COMPOSER_GAP = 32');
    expect(modalSource).toContain("Platform.OS === 'android' && isKeyboardVisible ? androidKeyboardInset : 0");
    expect(modalSource).toContain('onLayout={handleRootLayout}');
    expect(modalSource).toContain('inputRef.current?.blur()');
    expect(modalSource).toContain('resetTimerRef.current = setTimeout');
    expect(modalSource).toContain('dismissComposer();');
    expect(modalSource).toContain('{characterCount}/{MAX_MESSAGE_LENGTH}');
    expect(modalSource).toContain("t('chat.modal.retry.resend')");
    expect(modalSource).toContain("t('chat.modal.retry.cancel')");
    expect(modalSource).toContain('cancelPendingChatMessage(currentUserId, message.id)');
    expect(validationSource).toContain('Array.from(value).slice(0, MAX_MESSAGE_LENGTH)');
  });

  it('does not reveal whether a password reset account exists', () => {
    const edgeSource = readEdgeSource();
    const routeSource = edgeSource.slice(
      edgeSource.indexOf('app.post("/make-server-d962235e/auth/password-reset"'),
      edgeSource.indexOf('app.post("/make-server-d962235e/auth/signup"'),
    );

    expect(routeSource).not.toContain('"check_email_availability"');
    expect(routeSource).not.toContain('code: "ACCOUNT_NOT_FOUND"');
    expect(routeSource).toContain('resetPasswordForEmail');
    expect(routeSource).toContain('account-existence state enables account enumeration');
    expect(routeSource).toContain('}, 202)');
  });

  it('does not expose raw infrastructure errors through Edge API responses', () => {
    const edgeSource = readEdgeSource();

    expect(edgeSource).not.toMatch(/return c\.json\(\{ error: String\(error\)/);
    expect(edgeSource).not.toMatch(/return c\.json\(\{ error: error\.message/);
    expect(edgeSource).not.toMatch(/return c\.json\(\{ error: \w+Error\??\.message/);
  });

  it('keeps protected release identity stable', () => {
    const appConfig = JSON.parse(read('app.json')) as {
      expo?: {
        android?: { package?: string };
        ios?: { bundleIdentifier?: string };
        owner?: string;
        extra?: { eas?: { projectId?: string } };
      };
    };

    expect(appConfig.expo?.android?.package).toBe('com.wmatch.app');
    expect(appConfig.expo?.ios?.bundleIdentifier).toBe('com.wmatch.app');
    expect(appConfig.expo?.extra?.eas?.projectId).toBe('5aab8659-db24-4152-aa79-142f210e16d1');
    expect(appConfig.expo?.owner).toBe('cayann');
  });

  it('keeps UI typography scalable and above release minimums', () => {
    const sourceFiles = collectSourceFiles('src/app').concat(collectSourceFiles('src/shared'));

    for (const file of sourceFiles) {
      const source = read(file);

      expect(source, file).not.toContain('allowFontScaling={false}');
      expect(source, file).not.toMatch(/fontSize:\s*(9|10|11)\b/);
      expect(source, file).not.toContain('fontSize: theme.typography.tiny');
      expect(source, file).not.toMatch(/letterSpacing:\s*-/);
    }
  });

  it('keeps component colors and external URLs behind shared tokens', () => {
    const sourceFiles = collectSourceFiles('src/app');

    for (const file of sourceFiles) {
      const source = read(file);

      expect(source, file).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(source, file).not.toMatch(/rgba?\(/i);
      expect(source, file).not.toMatch(/https?:\/\//i);
    }

    expect(read('src/shared/theme/index.ts')).toContain('matchSuccess');
    expect(read('src/shared/config/externalLinks.ts')).toContain('TMDB_ATTRIBUTION_URL');
  });

  it('routes raw native modals through one accessibility focus primitive', () => {
    const componentFiles = collectSourceFiles('src/app/components');
    const rawModalFiles = componentFiles
      .filter((file) => /import\s*{[^}]*\bModal\b[^}]*}\s*from\s*['"]react-native['"]/s.test(read(file)))
      .map((file) => file.replaceAll('\\', '/'));
    const primitiveSource = read('src/app/components/ui/AccessibleModal.tsx');

    expect(rawModalFiles).toEqual(['src/app/components/ui/AccessibleModal.tsx']);
    expect(primitiveSource).toContain('AccessibilityInfo.setAccessibilityFocus');
    expect(primitiveSource).toContain('accessibilityViewIsModal');
    expect(primitiveSource).toContain('returnFocusRef');
  });

  it('keeps end-and-remove chat cleanup inside one service-only transaction', () => {
    const edgeSource = readEdgeSource();
    const migrationSource = read(
      'supabase/migrations/20260718120000_production_integrity_hardening.sql',
    );

    expect(edgeSource).toContain('"delete_chat_for_user_atomic"');
    expect(edgeSource).not.toContain('const deleteChatPairData = async');
    expect(migrationSource).toContain(
      'CREATE OR REPLACE FUNCTION public.delete_chat_for_user_atomic',
    );
    expect(migrationSource).toContain(
      'REVOKE ALL ON FUNCTION public.delete_chat_for_user_atomic(UUID, UUID, TEXT)',
    );
  });

  it('keeps privacy-sensitive writes and signed origin traffic behind service boundaries', () => {
    const edgeSource = readEdgeSource();
    const hmacSource = read('supabase/functions/make-server-d962235e/originHmac.ts');
    const deletionSource = read('supabase/functions/make-server-d962235e/accountDeletion.ts');
    const migrationSource = read(
      'supabase/migrations/20260830120000_security_privacy_closures.sql',
    );

    expect(edgeSource).toContain('validateOwnedProfilePhotos');
    expect(edgeSource).toContain('client_payload_hash');
    expect(edgeSource).toContain('idempotencyReplayed');
    expect(edgeSource).toContain('createOriginHmacMiddleware');
    expect(hmacSource).toContain('REQUIRE_CLOUDFLARE_ORIGIN_HMAC');
    expect(hmacSource).toContain('crypto.subtle.verify');
    expect(hmacSource).toContain('claimNonce');
    expect(deletionSource).toContain('resumeAccountDeletionJob');
    expect(migrationSource).toContain('REVOKE ALL ON FUNCTION public.check_email_availability(TEXT)');
    expect(migrationSource).toContain('CREATE TABLE IF NOT EXISTS public.edge_origin_hmac_nonces');
    expect(migrationSource).toContain('CREATE TABLE IF NOT EXISTS public.moderation_report_audit_events');
    expect(migrationSource).toContain('Service boundary messages');
    expect(migrationSource).toContain('Service boundary moderation reports');
  });

  it('keeps the existing profile report surface fail-closed and reporter-rate-limited', () => {
    const moderationSource = read(
      'supabase/functions/make-server-d962235e/domains/moderation.ts',
    );

    expect(moderationSource).toContain('value.trim().toLowerCase() === "profile"');
    expect(moderationSource).toContain('if (!targetType)');
    expect(moderationSource).toContain(
      'buildAbuseKey([currentUserId, getRequestRateLimitIdentity(c)])',
    );
    expect(moderationSource).not.toContain(
      'buildAbuseKey([currentUserId, targetUserId, getRequestRateLimitIdentity(c)])',
    );
  });

  it('keeps the UI hardening primitives wired to semantic tokens', () => {
    const rootSource = read('App.tsx');
    const appSource = read('src/app/App.tsx');
    const themeSource = read('src/shared/theme/index.ts');
    const screenSource = read('src/app/components/ui/Screen.tsx');
    const currentMovieSource = read('src/app/components/CurrentMovieBar.tsx');
    const bottomNavSource = read('src/app/components/BottomNav.tsx');
    const profileModalSource = read('src/app/components/ProfileModal.tsx');
    const swipeModalSource = read('src/app/components/SwipeModal.tsx');
    const buttonSource = read('src/app/components/ui/AppButton.tsx');
    const textFieldSource = read('src/app/components/ui/AppTextField.tsx');
    const chatBubbleSource = read('src/app/components/chat/ChatMessageBubble.tsx');
    const chatModalSource = readTogether(
      'src/app/components/ChatModal.tsx',
      'src/app/components/chat/ChatComposer.tsx',
      'src/app/components/chat/ChatHeader.tsx',
    );

    expect(themeSource).toContain('controlMinUnified: 48');
    expect(themeSource).toContain("body: { fontFamily: 'Inter_400Regular', fontSize: 13");
    expect(themeSource).toContain("control: { fontFamily: 'Inter_600SemiBold', fontSize: 12");
    expect(themeSource).toContain('dangerText');
    expect(themeSource).toContain('contentMaxNarrow');
    expect(screenSource).toContain('useWindowClass');
    expect(screenSource).toContain("keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}");
    expect(rootSource).toContain('initialMetrics={initialWindowMetrics}');
    expect(appSource).toContain('paddingTop: resolveDeviceEdgeInset(insets.top)');
    expect(appSource).toContain('paddingRight: Math.max(0, insets.right)');
    expect(currentMovieSource).not.toContain('useSafeAreaInsets');
    expect(bottomNavSource).toContain('paddingBottom: safeBottomInset');
    expect(profileModalSource).toContain("edges={['top', 'right', 'bottom', 'left']}");
    expect(swipeModalSource).toContain("edges={['top', 'right', 'bottom', 'left']}");
    expect(buttonSource).toContain('useReducedMotion');
    expect(buttonSource).toContain('hitSlop={4}');
    expect(buttonSource).toContain('disabledSurface');
    expect(buttonSource).not.toMatch(/disabled:\s*{\s*opacity/s);
    expect(textFieldSource).toContain('fieldFocused');
    expect(textFieldSource).toContain('accessibilityLabelledBy');
    expect(chatBubbleSource).toContain("maxWidth: '76%'");
    expect(chatBubbleSource).toContain('paddingHorizontal: 8');
    expect(chatBubbleSource).toContain('paddingVertical: 5');
    expect(chatBubbleSource).toContain('...theme.typography.roles.meta');
    expect(chatModalSource).toContain('minHeight: theme.layout.controlMinUnified');
    expect(chatModalSource).toContain('hitSlop={6}');
  });
});
