import React, { useState, useEffect } from 'react';
// Firebase 관련 모듈 임포트
import { initializeApp } from 'firebase/app';
import { 
    getAuth, 
    // createUserWithEmailAndPassword, // **인증 제거: 사용 안 함**
    signInWithCustomToken, 
    signInAnonymously,
    onAuthStateChanged
} from 'firebase/auth';
import { 
    getFirestore, 
    doc, 
    setDoc, 
    serverTimestamp,
    setLogLevel,
    collection,
    query,
    onSnapshot
} from 'firebase/firestore';

// Canvas 환경에서 제공되는 전역 변수 사용
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Firebase 인스턴스 설정
let app;

// --------------------------------------------------------------------------------
// 1. 회원 목록 컴포넌트 (MemberList)
// --------------------------------------------------------------------------------

const MemberList = ({ dbInstance, goRegister }) => {
    const [members, setMembers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!dbInstance) return;

        // /artifacts/{appId}/public/data/users 컬렉션 경로
        const collectionPath = `artifacts/${appId}/public/data/users`;
        const q = query(collection(dbInstance, collectionPath));
        
        setLoading(true);

        // onSnapshot을 사용하여 실시간으로 데이터 변화 감지
        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            const memberArray = [];
            querySnapshot.forEach((doc) => {
                const data = doc.data();
                // Firestore Timestamp 객체를 JS Date 객체로 변환하여 저장
                const date = data.registrationDate?.toDate ? data.registrationDate.toDate() : 'N/A';
                
                // **테스트 버전이므로 비밀번호 필드는 UI에서 제외합니다.**
                memberArray.push({
                    id: doc.id,
                    name: data.name,
                    email: data.email,
                    registrationDate: date,
                });
            });
            setMembers(memberArray);
            setLoading(false);
            setError(null);
        }, (err) => {
            console.error("Firestore 데이터 불러오기 오류: ", err);
            setError("회원 목록을 불러오는 중 오류가 발생했습니다.");
            setLoading(false);
        });

        // 컴포넌트 언마운트 시 리스너 해제
        return () => unsubscribe();
    }, [dbInstance]);

    const formatTimestamp = (date) => {
        if (date instanceof Date && !isNaN(date)) {
            return date.toLocaleDateString('ko-KR', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        }
        return '날짜 정보 없음';
    };

    return (
        <div className="p-4 sm:p-6 bg-white rounded-xl shadow-2xl border border-gray-200">
            <h2 className="text-3xl font-extrabold text-gray-900 text-center mb-6">
                회원 목록 ({members.length}명)
            </h2>
            <button
                onClick={goRegister}
                className="mb-6 w-full py-2 px-4 rounded-lg text-sm font-medium text-white bg-indigo-500 hover:bg-indigo-600 transition"
            >
                ← 회원가입 페이지로 돌아가기
            </button>
            
            {loading && <p className="text-center text-indigo-600 py-8">목록을 불러오는 중입니다...</p>}
            {error && <p className="text-center text-red-600 py-8">{error}</p>}

            {!loading && members.length === 0 && !error && (
                <p className="text-center text-gray-500 py-8">아직 등록된 회원이 없습니다. 가입해 보세요!</p>
            )}

            {!loading && members.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-300">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">이름</th>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">이메일</th>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">가입일</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {members.map((member) => (
                                <tr key={member.id} className="hover:bg-indigo-50 transition duration-150">
                                    <td className="px-3 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{member.name}</td>
                                    <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-600">{member.email}</td>
                                    <td className="px-3 py-4 whitespace-nowrap text-xs text-gray-500">{formatTimestamp(member.registrationDate)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

// --------------------------------------------------------------------------------
// 2. 회원가입 컴포넌트 (RegistrationForm)
// --------------------------------------------------------------------------------

const RegistrationForm = ({ authInstance, dbInstance, isAuthReady, goList }) => {
    // 폼 상태 관리
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    
    // UI 상태 관리
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);

    // 이메일 유효성 검사 (간단한 정규식)
    const isValidEmail = (email) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    };

    // 회원가입 처리 함수
    const handleRegistration = async (e) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);
        
        // 인증 로직을 건너뛰었지만, Firestore 인스턴스 준비 확인은 필요합니다.
        if (!isAuthReady || !dbInstance) {
            setError("데이터베이스 서비스가 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.");
            return;
        }

        // 1. 클라이언트 측 유효성 검사
        if (!name || !email || !password) {
            setError('이름, 이메일, 비밀번호를 모두 입력해 주세요.');
            return;
        }
        if (!isValidEmail(email)) {
            setError('유효하지 않은 이메일 형식입니다.');
            return;
        }
        if (password.length < 6) {
            setError('비밀번호는 6자 이상이어야 합니다.');
            return;
        }

        setLoading(true);

        try {
            // **[TEST-ONLY LOGIC]**
            // 2. Firebase Auth를 사용하지 않고, 고유 ID 생성 (인증 무시)
            const newUserId = crypto.randomUUID();

            // 3. Cloud Firestore: 사용자 정보 저장
            // /artifacts/{appId}/public/data/users/{newUserId} 경로에 저장
            const collectionPath = `artifacts/${appId}/public/data/users`;
            const userDocRef = doc(dbInstance, collectionPath, newUserId);
            
            await setDoc(userDocRef, {
                userId: newUserId,
                name: name,
                email: email,
                
                // 🚨🚨🚨 보안 경고: 테스트 목적으로만 일반 텍스트 비밀번호를 저장합니다. 🚨🚨🚨
                // 🚨 실제 운영 환경에서는 절대 비밀번호를 평문으로 저장하면 안 됩니다. 
                // 🚨 인증 시스템(Firebase Auth 등)에서 안전하게 해시 처리해야 합니다.
                password_test_only: password, 
                // 🚨🚨🚨
                
                registrationDate: serverTimestamp(),
            });
            
            setSuccess(`[TEST] 등록 성공! 생성된 ID: ${newUserId.substring(0, 8)}...`);
            
            // 폼 초기화
            setName('');
            setEmail('');
            setPassword('');

        } catch (dbError) {
            console.error("Firestore 데이터 저장 오류: ", dbError);
            setError(`데이터 저장 오류: ${dbError.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="w-full max-w-md bg-white p-8 rounded-xl shadow-2xl border border-gray-200">
            <h2 className="text-3xl font-extrabold text-gray-900 text-center mb-6">
                회원가입 (인증 우회 테스트 버전)
            </h2>
            <p className="text-center text-sm text-red-500 font-bold mb-4 p-2 bg-red-50 rounded-lg border border-red-200">
                🚨 경고: 이 버전은 테스트 목적으로만 인증을 우회합니다. 실제 운영 시 Firebase Auth를 활성화해야 합니다.
            </p>

            {/* 현재 사용자 ID 표시 (테스트 및 디버깅 목적) */}
            <div className="mb-4 p-3 bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs rounded-lg break-all">
                <span className="font-semibold">세션 ID (익명 인증):</span> {authInstance?.currentUser?.uid || '인증 중...'}
            </div>
            
            <form onSubmit={handleRegistration} className="space-y-4">
                {/* 이름 필드 */}
                <div>
                    <label htmlFor="name" className="block text-sm font-medium text-gray-700">이름</label>
                    <input
                        id="name"
                        name="name"
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500 transition duration-150"
                        placeholder="사용하실 이름을 입력하세요"
                    />
                </div>

                {/* 이메일 필드 */}
                <div>
                    <label htmlFor="email" className="block text-sm font-medium text-gray-700">이메일 주소</label>
                    <input
                        id="email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500 transition duration-150"
                        placeholder="example@email.com"
                    />
                </div>

                {/* 비밀번호 필드 */}
                <div>
                    <label htmlFor="password" className="block text-sm font-medium text-gray-700">비밀번호 (6자 이상)</label>
                    <input
                        id="password"
                        name="password"
                        type="password"
                        autoComplete="new-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500 transition duration-150"
                        placeholder="********"
                    />
                </div>

                {/* 메시지 영역 */}
                {error && (
                    <div className="p-3 text-sm text-red-700 bg-red-100 rounded-lg border border-red-300" role="alert">
                        {error}
                    </div>
                )}
                {success && (
                    <div className="p-3 text-sm text-green-700 bg-green-100 rounded-lg border border-green-300 flex justify-between items-center" role="alert">
                        <span>{success}</span>
                        <button 
                            type="button" 
                            onClick={goList} 
                            className="ml-4 py-1 px-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition shadow-md text-xs"
                        >
                            목록 보기 →
                        </button>
                    </div>
                )}
                
                {/* 제출 버튼 */}
                <button
                    type="submit"
                    disabled={loading || !isAuthReady}
                    className={`w-full flex justify-center py-2 px-4 border border-transparent rounded-lg shadow-md text-base font-medium text-white transition duration-300 ease-in-out ${
                        loading || !isAuthReady
                            ? 'bg-indigo-400 cursor-not-allowed'
                            : 'bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transform hover:scale-[1.01]'
                    }`}
                >
                    {loading ? (
                        <div className="flex items-center">
                            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            등록 중...
                        </div>
                    ) : '회원가입 완료 (테스트)'}
                </button>
                <button
                    type="button"
                    onClick={goList}
                    className="w-full flex justify-center py-2 px-4 border border-gray-300 rounded-lg shadow-sm text-base font-medium text-gray-700 bg-white hover:bg-gray-50 transition duration-300 ease-in-out"
                >
                    회원 목록 보기
                </button>
                {!isAuthReady && (
                    <p className="text-center text-xs text-gray-500 mt-2">서비스 초기화 중...</p>
                )}
            </form>
        </div>
    );
};


// --------------------------------------------------------------------------------
// 3. 메인 앱 컴포넌트 (라우팅 및 초기화)
// --------------------------------------------------------------------------------

const App = () => {
    // 뷰 상태 관리: 'register' 또는 'list'
    const [view, setView] = useState('register'); 
    
    const [error, setError] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);

    // Firebase 인스턴스 상태
    const [dbInstance, setDbInstance] = useState(null);
    const [authInstance, setAuthInstance] = useState(null);

    // Firebase 초기화 및 인증 처리
    useEffect(() => {
        setLogLevel('debug'); // Firestore 로깅 레벨 설정

        try {
            app = initializeApp(firebaseConfig);
            const dbRef = getFirestore(app);
            const authRef = getAuth(app);
            
            setDbInstance(dbRef);
            setAuthInstance(authRef);

            // 초기 인증 처리 (Canvas 환경 요구사항: Firestore 사용을 위해 익명 인증 필요)
            const authSetup = async () => {
                try {
                    if (initialAuthToken) {
                        await signInWithCustomToken(authRef, initialAuthToken);
                    } else {
                        await signInAnonymously(authRef);
                    }
                    // onAuthStateChanged를 사용하여 최종 인증 상태 확인 후 isAuthReady 설정
                    onAuthStateChanged(authRef, (user) => {
                        setIsAuthReady(true);
                    });
                } catch (e) {
                    console.error("초기 인증 오류: ", e);
                    setError("초기 인증 중 문제가 발생했습니다.");
                    setIsAuthReady(true);
                }
            };
            authSetup();

        } catch (e) {
            console.error("Firebase 초기화 오류: ", e);
            setError("Firebase 연결에 문제가 발생했습니다. 콘솔을 확인해 주세요.");
            setIsAuthReady(true);
        }
    }, []);

    const goRegister = () => setView('register');
    const goList = () => setView('list');
    
    return (
        <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4 sm:p-6 font-inter">
            {error && (
                <div className="fixed top-0 left-0 right-0 p-4 bg-red-600 text-white text-center z-50">
                    심각한 오류: {error}
                </div>
            )}
            
            {view === 'register' ? (
                <RegistrationForm 
                    authInstance={authInstance}
                    dbInstance={dbInstance}
                    isAuthReady={isAuthReady}
                    goList={goList}
                />
            ) : (
                <MemberList 
                    dbInstance={dbInstance}
                    goRegister={goRegister}
                />
            )}
        </div>
    );
};

export default App;
