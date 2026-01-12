import { createClient } from "@supabase/supabase-js";

/**
 * Creates a Supabase client with service role key for storage operations
 * This bypasses RLS and should ONLY be used server-side
 */
function createSupabaseStorageClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL. Please add it to your .env.local file."
    );
  }

  if (!supabaseServiceRoleKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY. Please add it to your .env.local file."
    );
  }

  // Use service role key to bypass RLS for storage operations
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Upload file to Supabase Storage (server-side only, bypasses RLS)
 */
export async function uploadFile(
  bucket: string,
  path: string,
  file: Buffer | Blob | ArrayBuffer,
  options?: {
    contentType?: string;
    upsert?: boolean;
  }
) {
  const supabase = createSupabaseStorageClient();

  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(path, file, {
      contentType: options?.contentType,
      upsert: options?.upsert ?? false,
    });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  return data;
}

/**
 * Get signed URL for file download (server-side only)
 */
export async function getSignedUrl(
  bucket: string,
  path: string,
  expiresIn: number = 3600
) {
  const supabase = createSupabaseStorageClient();

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);

  if (error) {
    throw new Error(`Failed to create signed URL: ${error.message}`);
  }

  return data;
}

/**
 * Delete file from Supabase Storage (server-side only)
 */
export async function deleteFile(bucket: string, path: string) {
  const supabase = createSupabaseStorageClient();

  const { error } = await supabase.storage.from(bucket).remove([path]);

  if (error) {
    throw new Error(`Failed to delete file: ${error.message}`);
  }
}

/**
 * Delete multiple files from Supabase Storage (server-side only)
 */
export async function deleteFiles(bucket: string, paths: string[]) {
  const supabase = createSupabaseStorageClient();

  if (paths.length === 0) {
    return;
  }

  const { error } = await supabase.storage.from(bucket).remove(paths);

  if (error) {
    throw new Error(`Failed to delete files: ${error.message}`);
  }
}

/**
 * List files in a directory (server-side only)
 */
export async function listFiles(
  bucket: string,
  path: string,
  options?: {
    limit?: number;
    offset?: number;
    sortBy?: { column: string; order?: "asc" | "desc" };
  }
) {
  const supabase = createSupabaseStorageClient();

  const { data, error } = await supabase.storage.from(bucket).list(path, {
    limit: options?.limit,
    offset: options?.offset,
    sortBy: options?.sortBy,
  });

  if (error) {
    throw new Error(`Failed to list files: ${error.message}`);
  }

  return data;
}

/**
 * Download file from Supabase Storage (server-side only)
 */
export async function downloadFile(
  bucket: string,
  path: string
): Promise<Buffer> {
  const supabase = createSupabaseStorageClient();

  const { data, error } = await supabase.storage.from(bucket).download(path);

  if (error) {
    throw new Error(`Failed to download file: ${error.message}`);
  }

  if (!data) {
    throw new Error("No data returned from storage");
  }

  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
