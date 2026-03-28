const mongoose = require('mongoose');

const mediaUploadSchema = new mongoose.Schema(
  {
    originalFilename: { type: String, required: true },
    s3Key: { type: String, required: true, unique: true },
    s3Url: { type: String, required: true },
    contentType: String,
    fileSize: Number,
    uploadedBy: { type: String, default: 'anonymous' },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', default: null },
  },
  { timestamps: true }
);

mediaUploadSchema.index({ eventId: 1 });

mediaUploadSchema.methods.toPublic = function () {
  return {
    id: this._id,
    filename: this.originalFilename,
    s3Url: this.s3Url,
    contentType: this.contentType,
    fileSize: this.fileSize,
    uploadedBy: this.uploadedBy,
    eventId: this.eventId,
    createdAt: this.createdAt,
  };
};

const MediaUpload = mongoose.model('MediaUpload', mediaUploadSchema);
module.exports = MediaUpload;