"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Download, FileText, Image, File, Calendar, Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  deleteDocumentAction,
  getDocumentSignedUrlAction,
  createDocumentAction,
} from "@/app/_actions/documents";
import { cn } from "@/app/_lib/utils/cn";

interface Document {
  id: string;
  patientId: string;
  visitId: string | null;
  filename: string;
  mimeType: string;
  size: string;
  storageUrl: string;
  uploadedAt: Date;
  uploadedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface DocumentsContentProps {
  patientId: string;
  patientName: string;
  documents: Document[];
}

export function DocumentsContent({
  patientId,
  patientName,
  documents: initialDocuments,
}: DocumentsContentProps) {
  const router = useRouter();
  const [documents, setDocuments] = React.useState<Document[]>(initialDocuments);
  const [showUploadModal, setShowUploadModal] = React.useState(false);
  const [isUploading, setIsUploading] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState<string | null>(null);
  const [isDownloading, setIsDownloading] = React.useState<string | null>(null);
  const [previewDocument, setPreviewDocument] = React.useState<Document | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setDocuments(initialDocuments);
  }, [initialDocuments]);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);

    try {
      const newDocuments: Document[] = [];

      for (const file of Array.from(files)) {
        // Validate file type
        const allowedTypes = [
          "image/jpeg",
          "image/jpg",
          "image/png",
          "image/gif",
          "image/webp",
          "application/pdf",
          "application/msword",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ];

        if (!allowedTypes.includes(file.type)) {
          toast.error(`File type not allowed: ${file.name}`);
          continue;
        }

        // Validate file size (10MB max)
        const maxSize = 10 * 1024 * 1024;
        if (file.size > maxSize) {
          toast.error(`File too large: ${file.name} (max 10MB)`);
          continue;
        }

        // Upload file to server
        const formData = new FormData();
        formData.append("file", file);
        formData.append("patientId", patientId);

        const uploadResponse = await fetch("/api/upload/document", {
          method: "POST",
          body: formData,
        });

        if (!uploadResponse.ok) {
          const error = await uploadResponse.json();
          throw new Error(error.error || "Upload failed");
        }

        const uploadData = await uploadResponse.json();

        // Save document metadata to DB
        const result = await createDocumentAction({
          patientId,
          filename: file.name,
          mimeType: file.type,
          size: file.size.toString(),
          storageUrl: uploadData.storageUrl,
        });

        if (!result.success) {
          throw new Error(result.error || "Failed to save document");
        }

        if (result.document) {
          newDocuments.push(result.document as Document);
        }
      }

      if (newDocuments.length > 0) {
        setDocuments((prev) => {
          const next = [...newDocuments, ...prev];
          next.sort(
            (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
          );
          return next;
        });
        toast.success(
          `Successfully uploaded ${newDocuments.length} document${newDocuments.length > 1 ? "s" : ""}`
        );
        setShowUploadModal(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        router.refresh();
      }
    } catch (error) {
      console.error("Error uploading document:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to upload document"
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (documentId: string, storageUrl: string) => {
    if (!confirm("Are you sure you want to delete this document?")) {
      return;
    }

    setIsDeleting(documentId);
    try {
      const result = await deleteDocumentAction(documentId, storageUrl);
      if (!result.success) {
        throw new Error(result.error || "Failed to delete document");
      }
      setDocuments((prev) => prev.filter((document) => document.id !== documentId));
      toast.success("Document deleted successfully");
      router.refresh();
    } catch (error) {
      console.error("Error deleting document:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to delete document"
      );
    } finally {
      setIsDeleting(null);
    }
  };

  const handlePreview = async (document: Document) => {
    setIsLoadingPreview(true);
    setPreviewDocument(document);
    try {
      const result = await getDocumentSignedUrlAction(document.storageUrl);
      if (!result.success || !result.signedUrl) {
        throw new Error(result.error || "Failed to get preview URL");
      }
      setPreviewUrl(result.signedUrl);
    } catch (error) {
      console.error("Error loading preview:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to load preview"
      );
      setPreviewDocument(null);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleDownload = async (document: Document) => {
    setIsDownloading(document.id);
    try {
      const result = await getDocumentSignedUrlAction(document.storageUrl);
      if (!result.success || !result.signedUrl) {
        throw new Error(result.error || "Failed to get download URL");
      }
      
      // Open in new tab for viewing/downloading
      window.open(result.signedUrl, "_blank");
      toast.success("Opening document...");
    } catch (error) {
      console.error("Error downloading document:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to download document"
      );
    } finally {
      setIsDownloading(null);
    }
  };

  const handleClosePreview = () => {
    setPreviewDocument(null);
    setPreviewUrl(null);
  };

  const formatDate = (date: Date | string) => {
    try {
      const d = new Date(date);
      return d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return "N/A";
    }
  };

  const formatFileSize = (size: string | number) => {
    const bytes = typeof size === "string" ? parseInt(size, 10) : size;
    if (isNaN(bytes)) return "Unknown size";
    
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith("image/")) {
      return <Image className="h-5 w-5" />;
    }
    if (mimeType === "application/pdf") {
      return <FileText className="h-5 w-5" />;
    }
    return <File className="h-5 w-5" />;
  };

  const canPreview = (mimeType: string) => {
    return mimeType.startsWith("image/") || mimeType === "application/pdf";
  };

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Documents</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage documents for {patientName}
          </p>
        </div>
        <Button onClick={() => setShowUploadModal(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Upload Document
        </Button>
      </div>

      {/* Documents List */}
      {documents.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <div className="text-center">
              <p className="text-muted-foreground mb-4">No documents uploaded</p>
              <Button onClick={() => setShowUploadModal(true)} variant="outline">
                <Plus className="h-4 w-4 mr-2" />
                Upload First Document
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {documents.map((document) => (
            <Card 
              key={document.id} 
              className={cn(
                "relative transition-colors",
                canPreview(document.mimeType) && "cursor-pointer hover:bg-accent/50"
              )}
              onClick={() => canPreview(document.mimeType) && handlePreview(document)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3 flex-1">
                    <div className="mt-1 text-muted-foreground">
                      {getFileIcon(document.mimeType)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-lg font-semibold truncate">
                        {document.filename}
                      </CardTitle>
                      <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          <span>{formatDate(document.uploadedAt)}</span>
                        </div>
                        <span>•</span>
                        <span>{formatFileSize(document.size)}</span>
                        {document.visitId && (
                          <>
                            <span>•</span>
                            <Badge variant="outline" className="text-xs">
                              Visit Document
                            </Badge>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1 ml-4">
                    {canPreview(document.mimeType) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePreview(document);
                        }}
                        disabled={isLoadingPreview && previewDocument?.id === document.id}
                        title="Preview"
                      >
                        {isLoadingPreview && previewDocument?.id === document.id ? (
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownload(document);
                      }}
                      disabled={isDownloading === document.id}
                      title="Download"
                    >
                      {isDownloading === document.id ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(document.id, document.storageUrl);
                      }}
                      disabled={isDeleting === document.id}
                      title="Delete"
                    >
                      {isDeleting === document.id ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      {/* Upload Modal */}
      <Dialog
        open={showUploadModal}
        onOpenChange={(open) => {
          setShowUploadModal(open);
          if (!open && fileInputRef.current) {
            fileInputRef.current.value = "";
          }
        }}
      >
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Upload Document</DialogTitle>
            <DialogDescription>
              Upload a document for this patient. Supported formats: Images (JPEG, PNG, GIF, WebP), PDF, Word documents (DOC, DOCX). Max size: 10MB.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="file-upload">Select File(s)</Label>
              <Input
                id="file-upload"
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                multiple
                accept="image/*,.pdf,.doc,.docx"
                disabled={isUploading}
                className={cn(isUploading && "opacity-50 cursor-not-allowed")}
              />
              {isUploading && (
                <p className="text-sm text-muted-foreground">
                  Uploading... Please wait.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowUploadModal(false);
                if (fileInputRef.current) {
                  fileInputRef.current.value = "";
                }
              }}
              disabled={isUploading}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Modal */}
      <Dialog open={!!previewDocument} onOpenChange={(open) => !open && handleClosePreview()}>
        <DialogContent className="sm:max-w-[90vw] max-w-[90vw] h-[90vh] max-h-[90vh] p-0 flex flex-col">
          {previewDocument && (
            <>
              <DialogHeader className="px-6 pt-6 pb-4 border-b flex-shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <DialogTitle className="text-lg font-semibold truncate">
                      {previewDocument.filename}
                    </DialogTitle>
                    <DialogDescription className="mt-1">
                      {formatFileSize(previewDocument.size)} • {formatDate(previewDocument.uploadedAt)}
                    </DialogDescription>
                  </div>
                  <div className="flex gap-2 ml-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDownload(previewDocument)}
                      disabled={isDownloading === previewDocument.id}
                    >
                      {isDownloading === previewDocument.id ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent mr-2" />
                      ) : (
                        <Download className="h-4 w-4 mr-2" />
                      )}
                      Download
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleClosePreview}
                      title="Close"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </DialogHeader>
              <div className="flex-1 overflow-auto p-6 bg-muted/50 min-h-0">
                {isLoadingPreview ? (
                  <div className="flex items-center justify-center h-full min-h-[400px]">
                    <div className="text-center">
                      <div className="h-8 w-8 animate-spin rounded-full border-4 border-current border-t-transparent mx-auto mb-4" />
                      <p className="text-muted-foreground">Loading preview...</p>
                    </div>
                  </div>
                ) : previewUrl ? (
                  previewDocument.mimeType.startsWith("image/") ? (
                    <div className="flex items-center justify-center h-full min-h-[400px]">
                      <img
                        src={previewUrl}
                        alt={previewDocument.filename}
                        className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
                      />
                    </div>
                  ) : previewDocument.mimeType === "application/pdf" ? (
                    <div className="w-full h-full min-h-[600px]">
                      <iframe
                        src={previewUrl}
                        className="w-full h-full min-h-[600px] border-0 rounded-lg"
                        title={previewDocument.filename}
                      />
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full min-h-[400px]">
                      <div className="text-center">
                        <File className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                        <p className="text-muted-foreground mb-4">
                          Preview not available for this file type
                        </p>
                        <Button onClick={() => handleDownload(previewDocument)}>
                          <Download className="h-4 w-4 mr-2" />
                          Download to View
                        </Button>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="flex items-center justify-center h-full min-h-[400px]">
                    <div className="text-center">
                      <div className="h-8 w-8 animate-spin rounded-full border-4 border-current border-t-transparent mx-auto mb-4" />
                      <p className="text-muted-foreground">Loading preview...</p>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

