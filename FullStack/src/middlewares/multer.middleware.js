import multer from 'multer';

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "./public/temp"); // specify the destination directory for uploaded files
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname) // use the original file name for the uploaded file   
}
}) 

export const upload = multer({ storage,
    
 });