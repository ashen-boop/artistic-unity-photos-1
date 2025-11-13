const express = require('express');
const multer = require('multer');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Google Drive Setup
const auth = new google.auth.GoogleAuth({
  credentials: {
    type: process.env.GOOGLE_TYPE,
    project_id: process.env.GOOGLE_PROJECT_ID,
    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_CLIENT_ID,
    auth_uri: process.env.GOOGLE_AUTH_URI,
    token_uri: process.env.GOOGLE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_PROVIDER_CERT_URL,
    client_x509_cert_url: process.env.GOOGLE_CLIENT_CERT_URL
  },
  scopes: ['https://www.googleapis.com/auth/drive.file']
});

const drive = google.drive({ version: 'v3', auth });

// Store upload progress
const uploadProgress = new Map();

// Create folder in Google Drive
async function createCustomerFolder(customerName, orderNumber) {
  const folderName = `${customerName}-ORDER-${orderNumber}-${Date.now()}`;
  
  const folderMetadata = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
  };

  const folder = await drive.files.create({
    resource: folderMetadata,
    fields: 'id, name, webViewLink'
  });

  // Make folder publicly viewable
  await drive.permissions.create({
    fileId: folder.data.id,
    requestBody: {
      role: 'reader',
      type: 'anyone'
    }
  });

  return {
    id: folder.data.id,
    name: folder.data.name,
    link: folder.data.webViewLink
  };
}

// Upload file to Google Drive
async function uploadToDrive(file, folderId) {
  const fileMetadata = {
    name: file.originalname,
    parents: [folderId]
  };

  const media = {
    mimeType: file.mimetype,
    body: fs.createReadStream(file.path)
  };

  const response = await drive.files.create({
    resource: fileMetadata,
    media: media,
    fields: 'id, name'
  });

  // Clean up temp file
  fs.unlinkSync(file.path);
  
  return response.data;
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = './uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Upload endpoint with progress tracking
app.post('/api/upload-photos', upload.array('photos', 10), async (req, res) => {
  try {
    const { customerName, orderNumber } = req.body;
    const files = req.files;
    const uploadId = Date.now().toString();

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    // Initialize progress
    uploadProgress.set(uploadId, {
      total: files.length,
      completed: 0,
      folderLink: null,
      status: 'uploading'
    });

    // Create customer folder
    const folder = await createCustomerFolder(customerName, orderNumber);
    
    // Update progress with folder link
    uploadProgress.set(uploadId, {
      ...uploadProgress.get(uploadId),
      folderLink: folder.link
    });

    // Upload each file
    for (let i = 0; i < files.length; i++) {
      try {
        await uploadToDrive(files[i], folder.id);
        
        // Update progress
        const progress = uploadProgress.get(uploadId);
        progress.completed = i + 1;
        uploadProgress.set(uploadId, progress);
        
      } catch (error) {
        console.error('Error uploading file:', error);
      }
    }

    // Mark as complete
    uploadProgress.set(uploadId, {
      ...uploadProgress.get(uploadId),
      status: 'completed'
    });

    res.json({
      success: true,
      uploadId: uploadId,
      folderLink: folder.link,
      message: `Successfully uploaded ${files.length} photos`
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed', details: error.message });
  }
});

// Progress tracking endpoint
app.get('/api/upload-progress/:uploadId', (req, res) => {
  const progress = uploadProgress.get(req.params.uploadId);
  if (!progress) {
    return res.status(404).json({ error: 'Upload not found' });
  }
  res.json(progress);
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ message: 'Photo Upload Server is running!' });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
