// email, secret_hash e device_id não podem ser pedidos ao Supabase.
export const PROFILE_COLUMNS = {
  account: 'id, nickname, theme_preference, display_name, avatar_path, dashboard_bg_path, dashboard_bg_apply_to_chats, dashboard_bg_mode',
  publicProfile: 'id, nickname, display_name, avatar_path',
  revealedProfile: 'id, display_name, avatar_path',
  dashboardBackground: 'dashboard_bg_path, dashboard_bg_mode',
  settings: 'dashboard_bg_apply_to_chats, dashboard_bg_mode',
  chatBackground: 'default_background_path, default_background_mode, dashboard_bg_path, dashboard_bg_mode, dashboard_bg_apply_to_chats',
  defaultBackground: 'default_background_path',
  sender: 'display_name, avatar_path',
} as const;

export const PARTICIPANT_COLUMNS = {
  identity: 'id',
  room: 'id, nickname, last_seen, show_profile, user_id',
  showProfile: 'show_profile',
  sender: 'nickname, show_profile, user_id',
  user: 'user_id',
} as const;
