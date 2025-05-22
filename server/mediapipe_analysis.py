import cv2
import mediapipe as mp
import numpy as np
import math
import json
import logging
import asyncio
import websockets
import time
import base64
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("mediapipe_analysis.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# MediaPipe solutions
mp_face_mesh = mp.solutions.face_mesh
mp_drawing = mp.solutions.drawing_utils
mp_drawing_styles = mp.solutions.drawing_styles
mp_hands = mp.solutions.hands
mp_pose = mp.solutions.pose

# Constants for face landmarks
FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
LEFT_EYE = [33, 133, 159, 145, 33]
RIGHT_EYE = [362, 263, 386, 374, 362]
LEFT_IRIS = [474, 475, 476, 477]
RIGHT_IRIS = [469, 470, 471, 472]

# Face landmarks mapping
FACE_LANDMARKS = {
    'oval_top': 10,
    'oval_bottom': 152,
    'oval_left1': 127,
    'oval_left2': 162,
    'oval_left3': 147,
    'oval_right1': 356,
    'oval_right2': 389,
    'oval_right3': 376,
    
    'eye_left_corner1': 33,
    'eye_left_corner2': 133,
    'eye_left_top': 159,
    'eye_left_bottom': 145,
    
    'eye_right_corner1': 362,
    'eye_right_corner2': 263,
    'eye_right_top': 386,
    'eye_right_bottom': 374,
    
    'brow_left_corner1': 46,
    'brow_left_corner2': 105,
    'brow_right_corner1': 276,
    'brow_right_corner2': 334,
    
    'nose_tip': 1,
    'nose_wing_left': 129,
    'nose_wing_right': 358,
    
    'mouth_corner_left': 61,
    'mouth_corner_right': 291,
    'mouth_top_center': 0,
    'mouth_bottom_center': 17,
    'mouth_top_left': 39,
    'mouth_top_right': 269,
    'mouth_bottom_left': 84,
    'mouth_bottom_right': 314
}

# Pose landmarks mapping
POSE_LANDMARKS = {
    'right_shoulder': 12,
    'left_shoulder': 11,
    'right_elbow': 14,
    'left_elbow': 13,
    'right_wrist': 16,
    'left_wrist': 15,
    'right_palm': [20, 22],
    'left_palm': [21, 19],
    'right_hip': 24,
    'left_hip': 23,
    'right_knee': 26,
    'left_knee': 25,
    'right_ankle': [28, 30],
    'left_ankle': [27, 29],
    'right_foot': 32,
    'left_foot': 31
}

class FaceAnalyzer:
    def __init__(self):
        self.face_mesh = mp_face_mesh.FaceMesh(
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )
        self.hands = mp_hands.Hands(
            max_num_hands=2,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )
        self.pose = mp_pose.Pose(
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )
        self.frame_count = 0
        self.last_analysis_time = time.time()
        self.analysis_interval = 0.2  # analyze every 200ms
        
    def analyze_frame(self, frame):
        """Analyze a video frame and return facial metrics"""
        current_time = time.time()
        self.frame_count += 1
        
        # Only analyze every 5th frame or when enough time has passed
        if self.frame_count % 5 != 0 and (current_time - self.last_analysis_time) < self.analysis_interval:
            return None, frame
            
        self.last_analysis_time = current_time
        
        # Convert the BGR image to RGB
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        frame_height, frame_width = frame.shape[:2]
        
        # Process with MediaPipe Face Mesh
        face_results = self.face_mesh.process(rgb_frame)
        hands_results = self.hands.process(rgb_frame)
        pose_results = self.pose.process(rgb_frame)
        
        # Create a copy of the frame for visualization
        annotated_frame = frame.copy()
        
        analysis_result = {
            "timestamp": datetime.now().isoformat(),
            "face_detected": False,
            "attention": "unknown",
            "emotion": "neutral",
            "eyes_open": False,
            "looking_at_screen": False,
            "hand_raised": False
        }
        
        # Process face landmarks if detected
        if face_results.multi_face_landmarks:
            analysis_result["face_detected"] = True
            face_landmarks = face_results.multi_face_landmarks[0]
            
            # Draw face mesh on the frame
            mp_drawing.draw_landmarks(
                image=annotated_frame,
                landmark_list=face_landmarks,
                connections=mp_face_mesh.FACEMESH_TESSELATION,
                landmark_drawing_spec=None,
                connection_drawing_spec=mp_drawing_styles.get_default_face_mesh_tesselation_style()
            )
            
            # Extract face landmarks as normalized coordinates
            landmarks = np.array([(lm.x, lm.y, lm.z) for lm in face_landmarks.landmark])
            
            # Calculate eye aspect ratio to detect blinks/closed eyes
            left_eye_ratio = self._calculate_eye_aspect_ratio(landmarks, LEFT_EYE)
            right_eye_ratio = self._calculate_eye_aspect_ratio(landmarks, RIGHT_EYE)
            
            # Determine if eyes are open
            eyes_open = left_eye_ratio > 0.2 and right_eye_ratio > 0.2
            analysis_result["eyes_open"] = eyes_open
            
            # Determine attention state
            if not eyes_open:
                analysis_result["attention"] = "sleepy"
            else:
                # Check head pose to determine if looking at screen
                head_pose = self._estimate_head_pose(landmarks)
                looking_at_screen = abs(head_pose["yaw"]) < 30 and abs(head_pose["pitch"]) < 20
                analysis_result["looking_at_screen"] = looking_at_screen
                
                if looking_at_screen:
                    analysis_result["attention"] = "attentive"
                else:
                    analysis_result["attention"] = "not_looking"
            
            # Analyze facial expression for emotion
            emotion = self._analyze_emotion(landmarks)
            analysis_result["emotion"] = emotion
            
            # Add text annotations to the frame
            cv2.putText(annotated_frame, f"Attention: {analysis_result['attention']}", 
                       (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
            cv2.putText(annotated_frame, f"Emotion: {analysis_result['emotion']}", 
                       (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
            cv2.putText(annotated_frame, f"Eyes: {'Open' if eyes_open else 'Closed'}", 
                       (10, 90), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
        
        # Check for raised hands using pose detection
        if pose_results.pose_landmarks:
            pose_landmarks = pose_results.pose_landmarks
            
            # Draw pose landmarks
            mp_drawing.draw_landmarks(
                annotated_frame,
                pose_landmarks,
                mp_pose.POSE_CONNECTIONS,
                landmark_drawing_spec=mp_drawing_styles.get_default_pose_landmarks_style()
            )
            
            # Check if hand is raised (wrist above shoulder)
            landmarks = np.array([(lm.x, lm.y, lm.z) for lm in pose_landmarks.landmark])
            
            left_wrist = landmarks[POSE_LANDMARKS['left_wrist']]
            left_shoulder = landmarks[POSE_LANDMARKS['left_shoulder']]
            right_wrist = landmarks[POSE_LANDMARKS['right_wrist']]
            right_shoulder = landmarks[POSE_LANDMARKS['right_shoulder']]
            
            hand_raised = (left_wrist[1] < left_shoulder[1] - 0.1) or (right_wrist[1] < right_shoulder[1] - 0.1)
            analysis_result["hand_raised"] = hand_raised
            
            cv2.putText(annotated_frame, f"Hand raised: {hand_raised}", 
                       (10, 120), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
            
            # If attention is unknown (no face detected) but pose is detected, set to not_looking
            if not analysis_result["face_detected"]:
                analysis_result["attention"] = "not_looking"
        
        # If no face and no pose detected, set attention to not_looking
        if not analysis_result["face_detected"] and not pose_results.pose_landmarks:
            analysis_result["attention"] = "not_looking"
        
        # If face is tired or sleepy and not looking at screen, mark as tired
        if analysis_result["attention"] == "sleepy" and not analysis_result["looking_at_screen"]:
            analysis_result["attention"] = "tired"
            
        return analysis_result, annotated_frame
    
    def _calculate_eye_aspect_ratio(self, landmarks, eye_indices):
        """Calculate the eye aspect ratio to determine if eyes are open"""
        # Convert normalized coordinates to pixel coordinates
        points = landmarks[eye_indices]
        
        # Calculate the vertical distances
        v1 = np.linalg.norm(points[1] - points[3])
        v2 = np.linalg.norm(points[2] - points[4])
        
        # Calculate the horizontal distance
        h = np.linalg.norm(points[0] - points[2])
        
        # Calculate eye aspect ratio
        ear = (v1 + v2) / (2.0 * h)
        return ear
    
    def _estimate_head_pose(self, landmarks):
        """Estimate head pose (yaw, pitch, roll) from face landmarks"""
        # Simple estimation based on face orientation
        # Get points for face orientation
        nose_tip = landmarks[FACE_LANDMARKS['nose_tip']]
        left_eye = landmarks[FACE_LANDMARKS['eye_left_corner1']]
        right_eye = landmarks[FACE_LANDMARKS['eye_right_corner1']]
        mouth_left = landmarks[FACE_LANDMARKS['mouth_corner_left']]
        mouth_right = landmarks[FACE_LANDMARKS['mouth_corner_right']]
        
        # Calculate face center
        face_center = (left_eye + right_eye) / 2
        
        # Calculate yaw (left-right rotation)
        eye_distance = np.linalg.norm(right_eye[:2] - left_eye[:2])
        nose_to_center_distance = np.linalg.norm(nose_tip[:2] - face_center[:2])
        yaw = (nose_tip[0] - face_center[0]) / eye_distance * 90
        
        # Calculate pitch (up-down rotation)
        vertical_ratio = (nose_tip[1] - face_center[1]) / eye_distance
        pitch = vertical_ratio * 45
        
        # Calculate roll (tilt)
        eye_angle = np.arctan2(right_eye[1] - left_eye[1], right_eye[0] - left_eye[0])
        roll = np.degrees(eye_angle)
        
        return {
            "yaw": yaw,
            "pitch": pitch,
            "roll": roll
        }
    
    def _analyze_emotion(self, landmarks):
        """Analyze facial expression to determine emotion"""
        # Get relevant landmarks for emotion detection
        mouth_corner_left = landmarks[FACE_LANDMARKS['mouth_corner_left']]
        mouth_corner_right = landmarks[FACE_LANDMARKS['mouth_corner_right']]
        mouth_top = landmarks[FACE_LANDMARKS['mouth_top_center']]
        mouth_bottom = landmarks[FACE_LANDMARKS['mouth_bottom_center']]
        
        brow_left1 = landmarks[FACE_LANDMARKS['brow_left_corner1']]
        brow_left2 = landmarks[FACE_LANDMARKS['brow_left_corner2']]
        brow_right1 = landmarks[FACE_LANDMARKS['brow_right_corner1']]
        brow_right2 = landmarks[FACE_LANDMARKS['brow_right_corner2']]
        
        # Calculate mouth curvature (for smile detection)
        mouth_center = (mouth_top + mouth_bottom) / 2
        mouth_width = np.linalg.norm(mouth_corner_right[:2] - mouth_corner_left[:2])
        smile_ratio = ((mouth_corner_left[1] + mouth_corner_right[1]) / 2 - mouth_center[1]) / mouth_width
        
        # Calculate brow position (for frown detection)
        brow_height_left = brow_left1[1] - brow_left2[1]
        brow_height_right = brow_right1[1] - brow_right2[1]
        
        # Determine emotion based on facial features
        if smile_ratio > 0.1:
            return "happy"
        elif brow_height_left < -0.02 and brow_height_right < -0.02:
            return "sad"
        else:
            return "neutral"
    
    def release(self):
        """Release resources"""
        self.face_mesh.close()
        self.hands.close()
        self.pose.close()


class MediaPipeAnalysisServer:
    def __init__(self, host="localhost", port=8765):
        self.host = host
        self.port = port
        self.face_analyzer = FaceAnalyzer()
        self.connected_clients = {}  # studentId -> websocket
        self.student_frames = {}     # studentId -> latest frame data
        self.student_analysis = {}   # studentId -> latest analysis result
        
    async def handle_client(self, websocket):
        """Handle a client connection"""
        student_id = None
        try:
            # First message should be student registration
            registration = await websocket.recv()
            reg_data = json.loads(registration)
            student_id = reg_data.get("studentId")
            conf_id = reg_data.get("confId")
            
            if not student_id or not conf_id:
                await websocket.send(json.dumps({"error": "Missing studentId or confId"}))
                return
                
            logger.info(f"Student {student_id} connected from conference {conf_id}")
            self.connected_clients[student_id] = websocket
            
            # Send confirmation
            await websocket.send(json.dumps({
                "type": "registration_success",
                "studentId": student_id,
                "message": "Successfully connected to MediaPipe analysis server"
            }))
            
            # Handle incoming video frames
            async for message in websocket:
                try:
                    data = json.loads(message)
                    if data.get("type") == "video_frame":
                        # Decode base64 image
                        img_data = base64.b64decode(data.get("frame"))
                        nparr = np.frombuffer(img_data, np.uint8)
                        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                        
                        if frame is not None:
                            # Store the latest frame
                            self.student_frames[student_id] = frame
                            
                            # Analyze the frame
                            analysis_result, annotated_frame = self.face_analyzer.analyze_frame(frame)
                            
                            if analysis_result:
                                # Store the latest analysis
                                self.student_analysis[student_id] = analysis_result
                                
                                # Encode the annotated frame
                                _, buffer = cv2.imencode('.jpg', annotated_frame)
                                annotated_frame_b64 = base64.b64encode(buffer).decode('utf-8')
                                
                                # Send back the analysis result and annotated frame
                                await websocket.send(json.dumps({
                                    "type": "analysis_result",
                                    "studentId": student_id,
                                    "result": analysis_result,
                                    "annotatedFrame": annotated_frame_b64
                                }))
                except json.JSONDecodeError:
                    logger.error("Failed to decode JSON message")
                except Exception as e:
                    logger.error(f"Error processing frame: {str(e)}")
                    
        except websockets.exceptions.ConnectionClosed:
            logger.info(f"Connection closed for student {student_id}")
        except Exception as e:
            logger.error(f"Error in handle_client: {str(e)}")
        finally:
            if student_id and student_id in self.connected_clients:
                del self.connected_clients[student_id]
                if student_id in self.student_frames:
                    del self.student_frames[student_id]
                if student_id in self.student_analysis:
                    del self.student_analysis[student_id]
    
    async def start_server(self):
        """Start the WebSocket server"""
        logger.info(f"Starting MediaPipe analysis server on {self.host}:{self.port}")
        server = await websockets.serve(
            lambda websocket: self.handle_client(websocket),
            self.host, 
            self.port
        )
        await server.wait_closed()
    
    def stop(self):
        """Stop the server and release resources"""
        self.face_analyzer.release()


async def main():
    """Main entry point"""
    logger.info("Starting mediapipe_analysis.py...")
    server = MediaPipeAnalysisServer()
    await server.start_server()


if __name__ == "__main__":
    print("Starting mediapipe_analysis.py...")
    logging.info("Logging configured")
    asyncio.run(main())
